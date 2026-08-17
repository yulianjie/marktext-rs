<script setup lang="ts">
/**
 * Tab bar — one row of file tabs above the editor.
 *
 * Click to activate, middle-click / × to close, drag-to-reorder via the
 * HTML5 native drag API (no extra dependency). The drag-over indicator is
 * just a left-border highlight on the tab being hovered.
 */
import { nextTick, ref } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { Close, Plus } from '@element-plus/icons-vue'
import { t } from '@/i18n'
import { bus } from '@/bus'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { open as shellOpen } from '@tauri-apps/plugin-shell'

const editor = useEditorStore()

const draggingId = ref<string | null>(null)
const hoverId = ref<string | null>(null)
const tabRefs = new Map<string, HTMLButtonElement>()

function activate(id: string) {
  editor.setCurrent(id)
}

async function close(id: string, ev: MouseEvent) {
  ev.stopPropagation()
  if (!await editor.closeTab(id)) return
  await nextTick()
  if (editor.currentFileId) tabRefs.get(editor.currentFileId)?.focus()
}

function onMiddleClick(id: string, ev: MouseEvent) {
  if (ev.button === 1) {
    ev.preventDefault()
    void editor.closeTab(id)
  }
}

function newTab() {
  editor.newUntitledTab()
}

function setTabRef(id: string, element: unknown) {
  if (element instanceof HTMLButtonElement) tabRefs.set(id, element)
  else tabRefs.delete(id)
}

function tabAriaLabel(filename: string, isSaved: boolean): string {
  return isSaved ? filename : `${filename} · ${t('tabs.unsaved')}`
}

async function focusTabAt(index: number) {
  const tab = editor.tabs[index]
  if (!tab) return
  activate(tab.id)
  await nextTick()
  tabRefs.get(tab.id)?.focus()
}

function onTabKeydown(id: string, ev: KeyboardEvent) {
  const index = editor.tabs.findIndex(tab => tab.id === id)
  if (index < 0) return
  let target = index
  if (ev.key === 'ArrowRight') target = (index + 1) % editor.tabs.length
  else if (ev.key === 'ArrowLeft') target = (index - 1 + editor.tabs.length) % editor.tabs.length
  else if (ev.key === 'Home') target = 0
  else if (ev.key === 'End') target = editor.tabs.length - 1
  else if (ev.key === 'Delete') {
    ev.preventDefault()
    void close(id, new MouseEvent('click'))
    return
  } else return
  ev.preventDefault()
  void focusTabAt(target)
}

async function closeTabsInOrder(ids: string[]): Promise<boolean> {
  for (const tabId of ids) {
    if (!await editor.closeTab(tabId)) return false
  }
  return true
}

/* ── context menu ─────────────────────────────────────────────── */
function parentDirOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(0, idx) : p
}

function onTabContextMenu(id: string, ev: MouseEvent) {
  ev.preventDefault()
  ev.stopPropagation()
  const tab = editor.tabs.find(x => x.id === id)
  if (!tab) return
  bus.emit('openContextMenu', {
    x: ev.clientX,
    y: ev.clientY,
    items: [
      { label: t('tabs.closeTab'), action: () => { void editor.closeTab(id) } },
      { label: t('tabs.closeOthers'), action: async () => {
        await closeTabsInOrder(editor.tabs.filter(tab => tab.id !== id).map(tab => tab.id))
      } },
      { label: t('tabs.closeAll'), action: async () => {
        await closeTabsInOrder(editor.tabs.map(tab => tab.id))
      } },
      { divider: true },
      { label: t('tabs.rename'), action: () => { editor.setCurrent(id); bus.emit('rename', undefined) } },
      { label: t('tabs.copyPath'), disabled: !tab.pathname, action: async () => {
        if (tab.pathname) await writeText(tab.pathname)
      } },
      { label: t('tabs.showInFolder'), disabled: !tab.pathname, action: async () => {
        if (tab.pathname) await shellOpen(parentDirOf(tab.pathname))
      } },
    ],
  })
}

/* ── drag-and-drop reordering ─────────────────────────────────── */
function onDragStart(id: string, ev: DragEvent) {
  draggingId.value = id
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move'
    // Required on Firefox; ignored on Chromium.
    ev.dataTransfer.setData('text/plain', id)
  }
}

function onDragOver(id: string, ev: DragEvent) {
  if (!draggingId.value || draggingId.value === id) return
  ev.preventDefault()
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
  hoverId.value = id
}

function onDragLeave(id: string) {
  if (hoverId.value === id) hoverId.value = null
}

function onDrop(id: string, ev: DragEvent) {
  ev.preventDefault()
  const fromId = draggingId.value
  draggingId.value = null
  hoverId.value = null
  if (!fromId || fromId === id) return
  const fromIdx = editor.tabs.findIndex(t => t.id === fromId)
  const toIdx = editor.tabs.findIndex(t => t.id === id)
  if (fromIdx < 0 || toIdx < 0) return
  editor.exchangeTabs(fromIdx, toIdx)
}

function onDragEnd() {
  draggingId.value = null
  hoverId.value = null
}
</script>

<template>
  <div class="tabs-bar">
    <div class="tabs-scroll" role="tablist">
      <div
        v-for="tab in editor.tabs"
        :key="tab.id"
        class="tab-shell"
        :class="{
          active: tab.id === editor.currentFileId,
          dirty: !tab.isSaved,
          dragging: tab.id === draggingId,
          'drop-target': tab.id === hoverId,
        }"
        draggable="true"
        @contextmenu="onTabContextMenu(tab.id, $event)"
        @mousedown.middle="onMiddleClick(tab.id, $event)"
        @dragstart="onDragStart(tab.id, $event)"
        @dragover="onDragOver(tab.id, $event)"
        @dragleave="onDragLeave(tab.id)"
        @drop="onDrop(tab.id, $event)"
        @dragend="onDragEnd"
      >
        <button
          :ref="element => setTabRef(tab.id, element)"
          type="button"
          class="tab"
          role="tab"
          :title="tab.pathname || tab.filename"
          :aria-selected="tab.id === editor.currentFileId"
          :aria-label="tabAriaLabel(tab.filename, tab.isSaved)"
          :tabindex="tab.id === editor.currentFileId ? 0 : -1"
          @click="activate(tab.id)"
          @keydown="onTabKeydown(tab.id, $event)"
        >
          <span v-if="!tab.isSaved" class="dot" aria-hidden="true" />
          <span class="label">{{ tab.filename }}</span>
        </button>
        <button
          type="button"
          class="close"
          :aria-label="`${t('tabs.closeTab')}: ${tab.filename}`"
          @click="close(tab.id, $event)"
        >
          <el-icon :size="13"><Close /></el-icon>
        </button>
      </div>
    </div>
    <button class="new-tab" @click="newTab" :aria-label="t('tabs.newTab')">
      <el-icon :size="14"><Plus /></el-icon>
    </button>
  </div>
</template>

<style scoped>
.tabs-bar {
  display: flex;
  height: 35px;
  background: var(--mt-tab-bg);
  border-bottom: 1px solid var(--mt-border);
  box-shadow: var(--mt-shadow-tabs);
  flex-shrink: 0;
  position: relative;
  z-index: 2;
}
.tabs-scroll {
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 1;
}
.tabs-scroll::-webkit-scrollbar { height: 3px; }
.tabs-scroll::-webkit-scrollbar-thumb { background: var(--mt-border, #d1d5da); }

.tab-shell {
  display: flex;
  align-items: center;
  height: 100%;
  border-right: 1px solid var(--mt-border);
  min-width: 100px;
  max-width: 280px;
  position: relative;
  transition: background-color 100ms, box-shadow 100ms;
}
.tab-shell:hover { background: var(--mt-row-hover); }
.tab-shell.active {
  background: var(--mt-tab-bg-active);
  box-shadow: inset 0 -2px 0 var(--mt-accent);
}
.tab-shell.dragging { opacity: 0.5; }
.tab-shell.drop-target { box-shadow: inset 3px 0 0 var(--mt-accent); }
.tab {
  min-width: 0;
  flex: 1;
  align-self: stretch;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 4px 0 10px;
  border: 0;
  color: var(--mt-fg-muted);
  background: transparent;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.tab-shell.active .tab {
  color: var(--mt-fg);
  font-weight: 550;
}
.tab:focus-visible,
.close:focus-visible,
.new-tab:focus-visible {
  outline: 2px solid var(--mt-accent);
  outline-offset: -3px;
}
.tab .label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  width: 7px;
  height: 7px;
  background: var(--mt-accent);
  border-radius: 50%;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--mt-accent) 55%, var(--mt-bg));
  flex: 0 0 auto;
}
.close {
  display: inline-flex;
  flex: 0 0 24px;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-right: 4px;
  border: none;
  background: transparent;
  color: var(--mt-fg-muted);
  cursor: pointer;
  padding: 0;
  border-radius: 5px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 100ms, background-color 100ms, color 100ms;
}
.tab-shell:hover .close,
.tab-shell:focus-within .close,
.tab-shell.active .close {
  opacity: 1;
  pointer-events: auto;
}
.close:hover { background: var(--mt-row-hover); color: var(--mt-fg); }

.new-tab {
  border: none;
  background: transparent;
  color: var(--mt-fg-muted);
  cursor: pointer;
  width: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.62;
  transition: opacity 100ms;
}
.tabs-bar:hover .new-tab,
.new-tab:focus-visible { opacity: 1; }
.new-tab:hover { background: var(--mt-row-hover); color: var(--mt-fg); }
</style>
