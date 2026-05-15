<script setup lang="ts">
/**
 * Editor page — top-level layout: title bar / tab bar / sidebar / Muya host.
 *
 * Owns the keyboard shortcuts (Ctrl+S save, Ctrl+O open, Ctrl+Shift+P
 * palette, Ctrl+T new tab) and the file-association open-on-launch handoff.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import TitleBar from '@/components/titleBar/TitleBar.vue'
import TabsBar from '@/components/editorWithTabs/TabsBar.vue'
import MuyaEditor from '@/components/editorWithTabs/MuyaEditor.vue'
import SideBar from '@/components/sideBar/SideBar.vue'
import CommandPalette from '@/components/commandPalette/CommandPalette.vue'
import AboutDialog from '@/components/about/AboutDialog.vue'
import { useEditorStore } from '@/stores/editor'
import { useLayoutStore } from '@/stores/layout'
import { usePreferencesStore } from '@/stores/preferences'
import { useListenForMainStore } from '@/stores/listenForMain'
import { useCommandCenterStore } from '@/stores/commandCenter'
import { useNotificationStore } from '@/stores/notification'
import { openFiles } from '@/services/tauri-invoke'
import { bus } from '@/bus'

const editor = useEditorStore()
const layout = useLayoutStore()
const prefs = usePreferencesStore()
const listener = useListenForMainStore()
const cc = useCommandCenterStore()
const notify = useNotificationStore()

/* ── shortcuts ───────────────────────────────────────────────── */
function onKey(ev: KeyboardEvent) {
  const cmd = ev.ctrlKey || ev.metaKey
  if (!cmd) return
  if (ev.key === 's' && !ev.shiftKey) {
    ev.preventDefault()
    void editor.saveCurrent()
  } else if (ev.key === 'S' && ev.shiftKey) {
    ev.preventDefault()
    void editor.saveAllTabs()
  } else if (ev.key === 'o') {
    ev.preventDefault()
    void doOpen()
  } else if (ev.key === 't') {
    ev.preventDefault()
    editor.newUntitledTab()
  } else if (ev.key === 'w') {
    ev.preventDefault()
    if (editor.currentFileId) editor.closeTab(editor.currentFileId)
  } else if (ev.key === 'P' && ev.shiftKey) {
    ev.preventDefault()
    bus.emit('show-command-palette', undefined)
  } else if (ev.key === 'b') {
    ev.preventDefault()
    layout.toggleSideBar()
  }
}

async function doOpen() {
  const paths = await openFiles()
  if (!paths.length) return
  for (const p of paths) {
    try {
      await editor.openFile(p)
    } catch (err) {
      notify.pushToast({
        type: 'error',
        title: 'Open failed',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/* ── command palette registry ───────────────────────────────── */
function registerBuiltinCommands() {
  cc.register({
    id: 'file.new',
    description: 'File: New Tab',
    shortcut: ['Ctrl+T'],
    execute: () => { editor.newUntitledTab() },
  })
  cc.register({
    id: 'file.open',
    description: 'File: Open…',
    shortcut: ['Ctrl+O'],
    execute: doOpen,
  })
  cc.register({
    id: 'file.save',
    description: 'File: Save',
    shortcut: ['Ctrl+S'],
    execute: () => editor.saveCurrent().then(() => {}),
  })
  cc.register({
    id: 'file.saveAll',
    description: 'File: Save All',
    shortcut: ['Ctrl+Shift+S'],
    execute: () => editor.saveAllTabs().then(() => {}),
  })
  cc.register({
    id: 'view.toggleSidebar',
    description: 'View: Toggle Sidebar',
    shortcut: ['Ctrl+B'],
    execute: () => layout.toggleSideBar(),
  })
  cc.register({
    id: 'app.about',
    description: 'Help: About MarkText',
    execute: () => bus.emit('aboutDialog', undefined),
  })
}

let unsubOpenFile: (() => void) | null = null

onMounted(async () => {
  await prefs.load()
  layout.syncFromPreferences()
  await listener.install()
  registerBuiltinCommands()
  window.addEventListener('keydown', onKey)

  // File-association open-on-launch handoff. The Tauri bridge dispatches a
  // CustomEvent on the window with `{ path }` payload.
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ path: string }>).detail
    void editor.openFile(detail.path).catch(err => {
      notify.pushToast({
        type: 'error',
        title: 'Open failed',
        message: err instanceof Error ? err.message : String(err),
      })
    })
  }
  window.addEventListener('mt:open-file', handler)
  unsubOpenFile = () => window.removeEventListener('mt:open-file', handler)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  unsubOpenFile?.()
})
</script>

<template>
  <div class="editor-page">
    <TitleBar />
    <div class="page-body">
      <SideBar v-if="layout.showSideBar" />
      <div class="editor-column">
        <TabsBar />
        <MuyaEditor />
      </div>
    </div>
    <CommandPalette />
    <AboutDialog />
  </div>
</template>

<style scoped>
.editor-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}
.page-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.editor-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
</style>
