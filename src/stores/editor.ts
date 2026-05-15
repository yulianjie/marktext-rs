/**
 * Editor store — port of the original `editor` Vuex module.
 *
 * Owns:
 * - `tabs`: every open document (in-memory state including markdown + history)
 * - `currentFileId`: which tab is active
 * - `toc`: hierarchical TOC for the current document
 *
 * Save / load round-trip through Tauri commands. File-system events
 * (`mt://fs/change`) are forwarded into reload prompts.
 *
 * The `pendingBaselineUpdate` flag preserves the legacy "first parse-roundtrip
 * after load isn't dirty" behaviour from the upstream editor — without it,
 * every freshly opened file is flagged as modified by Muya's normaliser.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  defaultFileState,
  getBlankFileState,
  getFileStateFromData,
  type DocumentState,
  type Encoding,
} from './help'
import { usePreferencesStore } from './preferences'
import { useNotificationStore } from './notification'
import {
  readMarkdown,
  saveMarkdown,
  saveAsDialog,
  renameFile as renameFileCmd,
} from '@/services/tauri-invoke'
import { v4 as uuid } from '@/util/uuid'

export interface TocItem {
  level: number
  content: string
  slug?: string
  children?: TocItem[]
}

function flatToTree(flat: { lvl: number; content: string; slug?: string }[]): TocItem[] {
  const root: TocItem[] = []
  const stack: { level: number; node: TocItem }[] = []
  for (const it of flat) {
    const node: TocItem = { level: it.lvl, content: it.content, slug: it.slug, children: [] }
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop()
    if (!stack.length) root.push(node)
    else stack[stack.length - 1].node.children!.push(node)
    stack.push({ level: node.level, node })
  }
  return root
}

export const useEditorStore = defineStore('editor', () => {
  const prefs = usePreferencesStore()
  const notify = useNotificationStore()

  const tabs = ref<DocumentState[]>([])
  const currentFileId = ref<string | null>(null)
  const listToc = ref<{ lvl: number; content: string; slug?: string }[]>([])

  const currentFile = computed<DocumentState | null>(() => {
    if (!currentFileId.value) return null
    return tabs.value.find(t => t.id === currentFileId.value) ?? null
  })

  const toc = computed<TocItem[]>(() => flatToTree(listToc.value))

  const hasUnsaved = computed(() => tabs.value.some(t => !t.isSaved))

  /* ─── tab management ─────────────────────────────────────────── */

  function findTabByPath(pathname: string): DocumentState | undefined {
    return tabs.value.find(t => t.pathname === pathname)
  }

  function setCurrent(id: string | null) {
    currentFileId.value = id
  }

  function newUntitledTab(initialMarkdown = '') {
    const file = getBlankFileState(
      tabs.value,
      prefs.defaultEncoding,
      prefs.endOfLine === 'crlf' ? 'crlf' : 'lf',
      initialMarkdown,
    )
    tabs.value.push(file)
    currentFileId.value = file.id
    return file
  }

  async function openFile(pathname: string) {
    const existing = findTabByPath(pathname)
    if (existing) {
      currentFileId.value = existing.id
      return existing
    }
    const doc = await readMarkdown(pathname)
    const filename = pathname.split(/[\\/]/).pop() || pathname
    const file = getFileStateFromData({
      markdown: doc.markdown,
      pathname: doc.path,
      filename,
      encoding: { encoding: doc.encoding.toLowerCase(), isBom: false } as Encoding,
      lineEnding: (doc.lineEnding === 'crlf' ? 'crlf' : 'lf') as 'lf' | 'crlf',
    })
    file.pendingBaselineUpdate = true
    tabs.value.push(file)
    currentFileId.value = file.id
    return file
  }

  function closeTab(id: string) {
    const idx = tabs.value.findIndex(t => t.id === id)
    if (idx === -1) return
    const tab = tabs.value[idx]
    if (!tab.isSaved) {
      notify.pushToast({
        type: 'warning',
        message: `${tab.filename} has unsaved changes — save or discard first.`,
      })
      return
    }
    tabs.value.splice(idx, 1)
    if (currentFileId.value === id) {
      const next = tabs.value[idx] || tabs.value[idx - 1] || null
      currentFileId.value = next?.id ?? null
    }
  }

  function exchangeTabs(fromIndex: number, toIndex: number) {
    if (
      fromIndex < 0 || fromIndex >= tabs.value.length ||
      toIndex < 0 || toIndex >= tabs.value.length
    ) return
    const [item] = tabs.value.splice(fromIndex, 1)
    tabs.value.splice(toIndex, 0, item)
  }

  /* ─── content change & save ──────────────────────────────────── */

  /**
   * Called from the Muya `change` handler. The first call after load is the
   * parse-roundtrip baseline — don't dirty the buffer for that one.
   */
  function applyContentChange(id: string, markdown: string, payload?: { wordCount?: DocumentState['wordCount']; cursor?: unknown; toc?: { lvl: number; content: string; slug?: string }[] }) {
    const tab = tabs.value.find(t => t.id === id)
    if (!tab) return
    if (tab.pendingBaselineUpdate) {
      tab.pendingBaselineUpdate = false
      tab.markdown = markdown
      tab.isSaved = true
    } else if (tab.markdown !== markdown) {
      tab.markdown = markdown
      tab.isSaved = false
    }
    if (payload?.wordCount) tab.wordCount = payload.wordCount
    if (payload?.cursor !== undefined) tab.cursor = payload.cursor
    if (payload?.toc && id === currentFileId.value) listToc.value = payload.toc
  }

  async function saveCurrent(): Promise<boolean> {
    const tab = currentFile.value
    if (!tab) return false
    return await saveTab(tab)
  }

  async function saveTab(tab: DocumentState): Promise<boolean> {
    let path = tab.pathname
    if (!path) {
      const picked = await saveAsDialog(tab.filename.endsWith('.md') ? tab.filename : `${tab.filename}.md`)
      if (!picked) return false
      path = picked
      tab.pathname = path
      tab.filename = path.split(/[\\/]/).pop() || tab.filename
    }
    try {
      await saveMarkdown(path, tab.markdown, {
        encoding: tab.encoding.encoding,
        lineEnding: tab.lineEnding,
      })
      tab.isSaved = true
      return true
    } catch (err) {
      notify.pushToast({
        type: 'error',
        title: 'Save failed',
        message: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }

  async function saveAllTabs(): Promise<boolean> {
    let ok = true
    for (const tab of tabs.value) {
      if (!tab.isSaved) ok = (await saveTab(tab)) && ok
    }
    return ok
  }

  async function renameTab(id: string, newPath: string) {
    const tab = tabs.value.find(t => t.id === id)
    if (!tab) return
    if (tab.pathname && tab.pathname !== newPath) {
      try { await renameFileCmd(tab.pathname, newPath) } catch (err) {
        notify.pushToast({
          type: 'error',
          title: 'Rename failed',
          message: err instanceof Error ? err.message : String(err),
        })
        return
      }
    }
    tab.pathname = newPath
    tab.filename = newPath.split(/[\\/]/).pop() || tab.filename
  }

  /* ─── notifications ─────────────────────────────────────────── */

  function pushTabNotification(id: string, message: string, type: 'info' | 'warning' | 'error' = 'info') {
    const tab = tabs.value.find(t => t.id === id)
    if (!tab) return
    tab.notifications.push({ type, message })
  }

  function clearTabNotifications(id: string) {
    const tab = tabs.value.find(t => t.id === id)
    if (tab) tab.notifications.length = 0
  }

  /* ─── bootstrap ─────────────────────────────────────────────── */

  /** Default state on fresh window — a single Untitled tab. */
  function bootstrap() {
    if (!tabs.value.length) {
      const file = defaultFileState()
      file.id = uuid()
      tabs.value.push(file)
      currentFileId.value = file.id
    }
  }

  return {
    // state
    tabs,
    currentFileId,
    listToc,
    // getters
    currentFile,
    toc,
    hasUnsaved,
    // tab mgmt
    findTabByPath,
    setCurrent,
    newUntitledTab,
    openFile,
    closeTab,
    exchangeTabs,
    // content & save
    applyContentChange,
    saveCurrent,
    saveTab,
    saveAllTabs,
    renameTab,
    // notifications
    pushTabNotification,
    clearTabNotifications,
    // lifecycle
    bootstrap,
  }
})
