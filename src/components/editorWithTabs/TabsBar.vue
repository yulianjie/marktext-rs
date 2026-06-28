<script setup lang="ts">
/**
 * Tab bar — one row of file tabs above the editor.
 *
 * Click to activate, middle-click / × to close, drag-to-reorder via the
 * HTML5 native drag API (no extra dependency). The drag-over indicator is
 * just a left-border highlight on the tab being hovered.
 */
import { ref } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { Close, Plus } from '@element-plus/icons-vue'
import { t } from '@/i18n'
import { bus } from '@/bus'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { open as shellOpen } from '@tauri-apps/plugin-shell'

const editor = useEditorStore()

const draggingId = ref<string | null>(null)
const hoverId = ref<string | null>(null)

function activate(id: string) {
  editor.setCurrent(id)
}

function close(id: string, ev: MouseEvent) {
  ev.stopPropagation()
  void editor.closeTab(id)
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
        for (const t of [...editor.tabs]) if (t.id !== id) await editor.closeTab(t.id)
      } },
      { label: t('tabs.closeAll'), action: async () => {
        for (const t of [...editor.tabs]) await editor.closeTab(t.id)
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
    <div class="tabs-scroll">
      <div
        v-for="tab in editor.tabs"
        :key="tab.id"
        class="tab"
        :class="{
          active: tab.id === editor.currentFileId,
          dirty: !tab.isSaved,
          dragging: tab.id === draggingId,
          'drop-target': tab.id === hoverId,
        }"
        :title="tab.pathname || tab.filename"
        draggable="true"
        @click="activate(tab.id)"
        @contextmenu="onTabContextMenu(tab.id, $event)"
        @mousedown.middle="onMiddleClick(tab.id, $event)"
        @dragstart="onDragStart(tab.id, $event)"
        @dragover="onDragOver(tab.id, $event)"
        @dragleave="onDragLeave(tab.id)"
        @drop="onDrop(tab.id, $event)"
        @dragend="onDragEnd"
      >
        <span class="indicator">
          <span class="dot" />
          <button class="close" @click="close(tab.id, $event)" :aria-label="t('tabs.closeTab')">
            <el-icon :size="12"><Close /></el-icon>
          </button>
        </span>
        <span class="label">{{ tab.filename }}</span>
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
.tabs-scroll::-webkit-scrollbar-thumb { background: #d1d5da; }

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  height: 100%;
  border-right: 1px solid var(--mt-border);
  cursor: pointer;
  font-size: 12px;
  color: var(--mt-fg-muted);
  white-space: nowrap;
  min-width: 100px;
  max-width: 280px;
  position: relative;
  transition: background-color 100ms;
}
.tab:hover { background: var(--mt-row-hover); }
.tab.active {
  background: var(--mt-tab-bg-active);
  color: var(--mt-fg);
  border-bottom: 2px solid var(--mt-accent);
}
.tab.dragging { opacity: 0.5; }
.tab.drop-target { box-shadow: inset 3px 0 0 var(--mt-accent); }
.tab .label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.indicator {
  width: 12px;
  height: 12px;
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tab .dot {
  display: none;
  width: 7px;
  height: 7px;
  background: var(--mt-accent);
  border-radius: 50%;
}
.tab .close {
  display: none;
  border: none;
  background: transparent;
  color: var(--mt-fg-muted);
  cursor: pointer;
  padding: 0;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
}
.tab .close:hover { background: #d1d5da; color: var(--mt-fg); }

/* Saved tabs: show close on hover (also when active). */
.tab:not(.dirty):hover .close,
.tab:not(.dirty).active .close { display: inline-flex; }

/* Dirty tabs: dot by default, close on hover. */
.tab.dirty .dot { display: inline-block; }
.tab.dirty:hover .dot { display: none; }
.tab.dirty:hover .close { display: inline-flex; }

.new-tab {
  border: none;
  background: transparent;
  color: var(--mt-fg-muted);
  cursor: pointer;
  width: 35px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 100ms;
}
.tabs-bar:hover .new-tab { opacity: 1; }
.new-tab:hover { background: var(--mt-row-hover); color: var(--mt-fg); }
</style>
