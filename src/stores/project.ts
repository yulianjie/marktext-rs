/**
 * Project store — the workspace tree (one root folder + nested folders/files).
 *
 * Port of the original `project` Vuex module. Initial tree is built by
 * calling Rust's `cmd_list_directory` recursively; subsequent FS changes
 * arrive via `mt://fs/change` events and update the tree incrementally.
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import {
  addDirectory,
  addFile,
  unlinkDirectory,
  unlinkFile,
  makeRoot,
  sortTree,
  type TreeFolder,
  type TreeFile,
} from './treeCtrl'
import {
  listDirectory,
  watchFolder,
  unwatchFolder,
  type DirEntry,
} from '@/services/tauri-invoke'
import { listenTyped } from '@/services/tauri-bridge'
import { useNotificationStore } from './notification'
import { usePreferencesStore } from './preferences'

interface ClipboardEntry {
  kind: 'copy' | 'cut'
  source: string
}

const MARKDOWN_EXT_RE = /\.(md|markdown|mkd|mdown|mkdn|mdtxt|mdtext)$/i

export function pathIsInsideRoot(rootPath: string, candidatePath: string): boolean {
  const windowsStyle = /^[a-z]:[\\/]/i.test(rootPath) || rootPath.startsWith('\\\\')
  const normalize = (value: string) => {
    const path = value.replace(/[\\/]+/g, '/').replace(/\/$/, '')
    return windowsStyle ? path.toLowerCase() : path
  }
  const root = normalize(rootPath)
  const candidate = normalize(candidatePath)
  return candidate === root || candidate.startsWith(`${root}/`)
}

function entryToTreeFile(entry: DirEntry): Omit<TreeFile, 'id'> {
  return {
    name: entry.name,
    pathname: entry.path,
    isFile: true,
    isDirectory: false,
    isMarkdown: entry.isMarkdown || MARKDOWN_EXT_RE.test(entry.name),
    birthTime: entry.createdMs ?? entry.modifiedMs,
    modifiedTime: entry.modifiedMs,
  }
}

async function buildSubtree(root: TreeFolder, dir: string, depth: number) {
  if (depth > 8) return // safety net against pathological symlinks
  const entries = await listDirectory(dir)
  for (const entry of entries) {
    if (entry.isDir) {
      addDirectory(root, { pathname: entry.path })
      await buildSubtree(root, entry.path, depth + 1)
    } else {
      addFile(root, entryToTreeFile(entry))
    }
  }
}

export const useProjectStore = defineStore('project', () => {
  const notify = useNotificationStore()
  const prefs = usePreferencesStore()

  const projectTree = ref<TreeFolder | null>(null)
  const activeItem = ref<{ pathname: string; isDirectory: boolean } | null>(null)
  const createCache = ref<{ dirname: string; type: 'file' | 'directory' } | null>(null)
  const renameCache = ref<string | null>(null)
  const clipboard = ref<ClipboardEntry | null>(null)
  let watcherInstalled = false

  async function openRoot(pathname: string) {
    if (projectTree.value?.pathname === pathname) return
    if (projectTree.value) {
      try { await unwatchFolder(projectTree.value.pathname) } catch { /* ignore */ }
    }
    const root = makeRoot(pathname)
    projectTree.value = root
    try {
      await buildSubtree(root, pathname, 0)
      sortTree(root, prefs.fileSortBy)
      await watchFolder(pathname)
      installWatcher()
      prefs.pushRecentFolder(pathname)
    } catch (err) {
      notify.pushToast({
        type: 'error',
        title: 'Open folder failed',
        message: err instanceof Error ? err.message : String(err),
      })
      projectTree.value = null
    }
  }

  async function closeRoot() {
    if (!projectTree.value) return
    try { await unwatchFolder(projectTree.value.pathname) } catch { /* ignore */ }
    projectTree.value = null
    activeItem.value = null
    createCache.value = null
    renameCache.value = null
    clipboard.value = null
  }

  function installWatcher() {
    if (watcherInstalled) return
    watcherInstalled = true
    void listenTyped('mt://fs/change', event => {
      const root = projectTree.value
      if (!root) return
      if (event.kind === 'renamed') {
        const fromInside = pathIsInsideRoot(root.pathname, event.from)
        const toInside = pathIsInsideRoot(root.pathname, event.to)
        if (!fromInside && !toInside) return
        if (fromInside) {
          unlinkFile(root, { pathname: event.from })
          unlinkDirectory(root, { pathname: event.from })
        }
        if (toInside) void refreshParent(root, event.to)
        return
      }
      if (!pathIsInsideRoot(root.pathname, event.path)) return
      switch (event.kind) {
        case 'created':
          // We don't know dir-vs-file from path alone — list parent to find out.
          void refreshParent(root, event.path)
          break
        case 'modified':
          // Refresh metadata as well as structure so modified-time sorting
          // reorders immediately after a save.
          void refreshParent(root, event.path)
          break
        case 'removed':
          // Try both removal kinds; the wrong one is a no-op.
          unlinkFile(root, { pathname: event.path })
          unlinkDirectory(root, { pathname: event.path })
          break
      }
    })
  }

  async function refreshParent(root: TreeFolder, fullPath: string) {
    const parent = fullPath.replace(/[\\/][^\\/]+$/, '')
    if (!parent.startsWith(root.pathname)) return
    try {
      const entries = await listDirectory(parent)
      for (const entry of entries) {
        if (entry.isDir) addDirectory(root, { pathname: entry.path })
        else addFile(root, entryToTreeFile(entry))
      }
      sortTree(root, prefs.fileSortBy)
    } catch { /* swallow — watcher may fire mid-rename and the dir vanishes */ }
  }

  function setActiveItem(item: { pathname: string; isDirectory: boolean } | null) {
    activeItem.value = item
  }

  function startCreate(dirname: string, type: 'file' | 'directory') {
    createCache.value = { dirname, type }
  }
  function cancelCreate() { createCache.value = null }

  function startRename(pathname: string) { renameCache.value = pathname }
  function cancelRename() { renameCache.value = null }

  function setClipboard(entry: ClipboardEntry | null) { clipboard.value = entry }

  watch(
    () => prefs.fileSortBy,
    mode => { if (projectTree.value) sortTree(projectTree.value, mode) },
  )

  return {
    projectTree,
    activeItem,
    createCache,
    renameCache,
    clipboard,
    openRoot,
    closeRoot,
    setActiveItem,
    startCreate,
    cancelCreate,
    startRename,
    cancelRename,
    setClipboard,
  }
})
