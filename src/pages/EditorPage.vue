<script setup lang="ts">
/**
 * Editor page — top-level layout: title bar / tab bar / sidebar / Muya host.
 *
 * Owns the keyboard shortcuts, the file-association open-on-launch handoff,
 * the native menu action router, and webview drag-drop file opens.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import TitleBar from '@/components/titleBar/TitleBar.vue'
import TabsBar from '@/components/editorWithTabs/TabsBar.vue'
import MuyaEditor from '@/components/editorWithTabs/MuyaEditor.vue'
import SourceCodePane from '@/components/editorWithTabs/SourceCodePane.vue'
import SideBar from '@/components/sideBar/SideBar.vue'
import CommandPalette from '@/components/commandPalette/CommandPalette.vue'
import AboutDialog from '@/components/about/AboutDialog.vue'
import RenameDialog from '@/components/rename/RenameDialog.vue'
import RecentDialog from '@/components/recent/RecentDialog.vue'
import FindReplaceBar from '@/components/search/FindReplaceBar.vue'
import { useEditorStore } from '@/stores/editor'
import { useLayoutStore } from '@/stores/layout'
import { usePreferencesStore } from '@/stores/preferences'
import { useListenForMainStore } from '@/stores/listenForMain'
import { useCommandCenterStore } from '@/stores/commandCenter'
import { useNotificationStore } from '@/stores/notification'
import { openFiles, saveAsDialog, exportHtml } from '@/services/tauri-invoke'
import { listenTyped } from '@/services/tauri-bridge'
import { applyPreferencesToDom } from '@/services/preferences-applier'
import { bus } from '@/bus'

const editor = useEditorStore()
const layout = useLayoutStore()
const prefs = usePreferencesStore()
const listener = useListenForMainStore()
const cc = useCommandCenterStore()
const notify = useNotificationStore()

const dragOver = ref(false)

/* ── shortcuts ───────────────────────────────────────────────── */
function onKey(ev: KeyboardEvent) {
  const cmd = ev.ctrlKey || ev.metaKey
  if (!cmd) return
  if (ev.key === 's' && !ev.shiftKey) {
    ev.preventDefault(); void editor.saveCurrent()
  } else if (ev.key === 'S' && ev.shiftKey) {
    ev.preventDefault(); void editor.saveAllTabs()
  } else if (ev.key === 'o' && !ev.shiftKey) {
    ev.preventDefault(); void doOpen()
  } else if (ev.key === 'O' && ev.shiftKey) {
    ev.preventDefault(); void doOpenFolder()
  } else if (ev.key === 't') {
    ev.preventDefault(); editor.newUntitledTab()
  } else if (ev.key === 'w') {
    ev.preventDefault()
    if (editor.currentFileId) editor.closeTab(editor.currentFileId)
  } else if (ev.key === 'P' && ev.shiftKey) {
    ev.preventDefault(); bus.emit('show-command-palette', undefined)
  } else if (ev.key === 'b') {
    ev.preventDefault(); layout.toggleSideBar()
  } else if (ev.key === 'f' && !ev.shiftKey) {
    ev.preventDefault(); editor.findReplaceOpen = true
  } else if (ev.key === 'h') {
    ev.preventDefault(); editor.findReplaceOpen = true
  } else if (ev.key === 'p' && !ev.shiftKey) {
    ev.preventDefault(); doPrint()
  }
}

async function doOpen() {
  const paths = await openFiles()
  if (!paths.length) return
  for (const p of paths) {
    try { await editor.openFile(p) }
    catch (err) {
      notify.pushToast({ type: 'error', title: 'Open failed', message: err instanceof Error ? err.message : String(err) })
    }
  }
}

async function doOpenFolder() {
  const { openFolder } = await import('@/services/tauri-invoke')
  const { useProjectStore } = await import('@/stores/project')
  const path = await openFolder()
  if (!path) return
  await useProjectStore().openRoot(path)
}

async function doExportHtml() {
  const tab = editor.currentFile
  if (!tab) return
  const target = await saveAsDialog((tab.filename.replace(/\.md$/i, '') || 'untitled') + '.html')
  if (!target) return
  const muya = editor.getMuyaInstance()
  if (!muya) {
    notify.pushToast({ type: 'error', title: 'Export failed', message: 'Editor not ready.' })
    return
  }
  try {
    // @ts-expect-error Muya helper is plain JS with no .d.ts.
    const { default: ExportHtml } = await import('muya/lib/utils/exportHtml')
    const exporter = new ExportHtml(tab.markdown, muya)
    const html = await exporter.generate({
      title: tab.filename.replace(/\.md$/i, ''),
      toc: false,
      printOptimization: false,
      extraCss: '',
    })
    await exportHtml(target, html)
    notify.pushToast({ type: 'success', message: `Exported to ${target}` })
  } catch (err) {
    notify.pushToast({ type: 'error', title: 'Export failed', message: err instanceof Error ? err.message : String(err) })
  }
}

function doPrint() { window.print() }

/* ── menu action router ─────────────────────────────────────── */
const MENU_ACTIONS: Record<string, () => void | Promise<void>> = {
  'file.new': () => { editor.newUntitledTab() },
  'file.newWindow': async () => { const { newWindow } = await import('@/services/tauri-invoke'); await newWindow() },
  'file.open': doOpen,
  'file.openFolder': doOpenFolder,
  'file.save': () => { void editor.saveCurrent() },
  'file.saveAs': async () => {
    const tab = editor.currentFile
    if (!tab) return
    const picked = await saveAsDialog(tab.filename)
    if (!picked) return
    tab.pathname = picked
    tab.filename = picked.split(/[\\/]/).pop() || tab.filename
    await editor.saveCurrent()
  },
  'file.saveAll': () => { void editor.saveAllTabs() },
  'file.exportHtml': doExportHtml,
  'file.print': doPrint,
  'file.closeTab': () => { if (editor.currentFileId) editor.closeTab(editor.currentFileId) },
  'file.closeWindow': async () => { const win = await import('@tauri-apps/api/window'); await win.getCurrentWindow().close() },
  'edit.find': () => { editor.findReplaceOpen = true },
  'edit.replace': () => { editor.findReplaceOpen = true },
  'edit.undo': () => bus.emit('undo', undefined),
  'edit.redo': () => bus.emit('redo', undefined),
  'edit.selectAll': () => bus.emit('selectAll', undefined),
  'edit.copyAsMarkdown': () => bus.emit('copyAsMarkdown', undefined),
  'edit.copyAsHtml': () => bus.emit('copyAsHtml', undefined),
  'edit.pasteAsPlainText': () => bus.emit('pasteAsPlainText', undefined),
  'view.toggleSidebar': () => layout.toggleSideBar(),
  'view.toggleTabBar': () => layout.toggleTabBar(),
  'view.toggleSourceCode': () => editor.toggleSourceCode(),
  'view.toggleTypewriter': () => { prefs.typewriter = !prefs.typewriter },
  'view.toggleFocus': () => { prefs.focus = !prefs.focus },
  'view.commandPalette': () => bus.emit('show-command-palette', undefined),
  'view.zoomIn': () => { void prefs.set('zoom', Math.min(prefs.zoom + 0.1, 2)) },
  'view.zoomOut': () => { void prefs.set('zoom', Math.max(prefs.zoom - 0.1, 0.5)) },
  'view.zoomReset': () => { void prefs.set('zoom', 1) },
  'window.alwaysOnTop': async () => {
    const win = await import('@tauri-apps/api/window')
    const w = win.getCurrentWindow()
    const cur = await w.isAlwaysOnTop()
    await w.setAlwaysOnTop(!cur)
  },
  'window.fullscreen': async () => {
    const win = await import('@tauri-apps/api/window')
    const w = win.getCurrentWindow()
    const cur = await w.isFullscreen()
    await w.setFullscreen(!cur)
  },
  'help.openSettings': async () => { const { openSettings } = await import('@/services/tauri-invoke'); await openSettings() },
  'help.about': () => bus.emit('aboutDialog', undefined),
  'help.openDocs': async () => { const sh = await import('@tauri-apps/plugin-shell'); await sh.open('https://github.com/marktext/marktext') },
  'help.openIssues': async () => { const sh = await import('@tauri-apps/plugin-shell'); await sh.open('https://github.com/marktext/marktext/issues') },
}

function routeMenuAction(id: string) {
  if (id.startsWith('paragraph.')) { bus.emit('paragraph', id.slice('paragraph.'.length)); return }
  if (id.startsWith('format.')) { bus.emit('format', id.slice('format.'.length)); return }
  const fn = MENU_ACTIONS[id]
  if (fn) void fn()
  else console.warn('[menu] no handler for action', id)
}

/* ── command palette registry ───────────────────────────────── */
function registerBuiltinCommands() {
  const reg = (id: string, description: string, execute: () => void | Promise<void>, shortcut?: string[]) =>
    cc.register({ id, description, shortcut, execute })
  reg('file.new', 'File: New Tab', () => { editor.newUntitledTab() }, ['Ctrl+T'])
  reg('file.open', 'File: Open…', doOpen, ['Ctrl+O'])
  reg('file.openFolder', 'File: Open Folder…', doOpenFolder, ['Ctrl+Shift+O'])
  reg('file.save', 'File: Save', () => { void editor.saveCurrent() }, ['Ctrl+S'])
  reg('file.saveAs', 'File: Save As…', () => MENU_ACTIONS['file.saveAs'](), ['Ctrl+Shift+S'])
  reg('file.saveAll', 'File: Save All', () => { void editor.saveAllTabs() })
  reg('file.exportHtml', 'File: Export HTML…', doExportHtml)
  reg('file.print', 'File: Print / Export PDF…', doPrint, ['Ctrl+P'])
  reg('file.rename', 'File: Rename…', () => bus.emit('rename', undefined))
  reg('file.recent', 'File: Open Recent…', () => bus.emit('show-recent', undefined))
  reg('view.toggleSidebar', 'View: Toggle Sidebar', () => layout.toggleSideBar(), ['Ctrl+B'])
  reg('view.toggleSourceCode', 'View: Toggle Source Code Mode', () => editor.toggleSourceCode(), ['Ctrl+Alt+S'])
  reg('view.toggleTypewriter', 'View: Toggle Typewriter Mode', () => { prefs.typewriter = !prefs.typewriter })
  reg('view.toggleFocus', 'View: Toggle Focus Mode', () => { prefs.focus = !prefs.focus })
  reg('view.commandPalette', 'View: Command Palette', () => bus.emit('show-command-palette', undefined), ['Ctrl+Shift+P'])
  reg('edit.find', 'Edit: Find', () => { editor.findReplaceOpen = true }, ['Ctrl+F'])
  reg('edit.replace', 'Edit: Find & Replace', () => { editor.findReplaceOpen = true }, ['Ctrl+H'])
  reg('app.about', 'Help: About MarkText', () => bus.emit('aboutDialog', undefined))
}

let unsubOpenFile: (() => void) | null = null
let unsubDrop: (() => void) | null = null

onMounted(async () => {
  await prefs.load()
  layout.syncFromPreferences()
  applyPreferencesToDom()
  await listener.install()
  registerBuiltinCommands()
  window.addEventListener('keydown', onKey)

  // File-association launches forward to a custom DOM event.
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ path: string }>).detail
    void editor.openFile(detail.path).catch(err => {
      notify.pushToast({ type: 'error', title: 'Open failed', message: err instanceof Error ? err.message : String(err) })
    })
  }
  window.addEventListener('mt:open-file', handler)
  unsubOpenFile = () => window.removeEventListener('mt:open-file', handler)

  // Native menu actions.
  void listenTyped('mt://menu/action', id => routeMenuAction(id))

  // Print request — Rust's cmd_export_pdf emits this when the user picks
  // "Export PDF" / "Print" from the menu. We invoke the browser's native
  // print dialog so the OS handles "Save as PDF".
  void listenTyped('mt://export/print', () => { window.print() })

  // Drag-and-drop files onto the webview.
  try {
    const wv = getCurrentWebview()
    unsubDrop = await wv.onDragDropEvent(async ev => {
      const p = ev.payload
      if (p.type === 'enter' || p.type === 'over') {
        dragOver.value = true
      } else if (p.type === 'leave') {
        dragOver.value = false
      } else if (p.type === 'drop') {
        dragOver.value = false
        for (const file of p.paths) {
          try { await editor.openFile(file) }
          catch (err) {
            notify.pushToast({ type: 'error', title: 'Open failed', message: err instanceof Error ? err.message : String(err) })
          }
        }
      }
    })
  } catch (err) {
    console.warn('[drag-drop] failed to install handler', err)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  unsubOpenFile?.()
  unsubDrop?.()
})
</script>

<template>
  <div class="editor-page" :class="{ 'drag-over': dragOver }">
    <TitleBar />
    <div class="page-body">
      <SideBar v-if="layout.showSideBar" />
      <div class="editor-column">
        <TabsBar />
        <div class="editor-stage">
          <MuyaEditor v-show="!editor.sourceCodeMode" />
          <SourceCodePane v-if="editor.sourceCodeMode" />
          <FindReplaceBar />
        </div>
      </div>
    </div>
    <CommandPalette />
    <AboutDialog />
    <RenameDialog />
    <RecentDialog />
    <div v-if="dragOver" class="drop-veil">Drop to open</div>
  </div>
</template>

<style scoped>
.editor-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  position: relative;
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
.editor-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
.drop-veil {
  position: absolute;
  inset: 0;
  background: rgba(3, 102, 214, 0.10);
  border: 2px dashed rgba(3, 102, 214, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 500;
  color: #0366d6;
  pointer-events: none;
  z-index: 100;
}
</style>
