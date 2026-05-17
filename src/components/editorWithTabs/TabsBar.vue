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

const editor = useEditorStore()

const draggingId = ref<string | null>(null)
const hoverId = ref<string | null>(null)

function activate(id: string) {
  editor.setCurrent(id)
}

function close(id: string, ev: MouseEvent) {
  ev.stopPropagation()
  editor.closeTab(id)
}

function onMiddleClick(id: string, ev: MouseEvent) {
  if (ev.button === 1) {
    ev.preventDefault()
    editor.closeTab(id)
  }
}

function newTab() {
  editor.newUntitledTab()
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
        @mousedown.middle="onMiddleClick(tab.id, $event)"
        @dragstart="onDragStart(tab.id, $event)"
        @dragover="onDragOver(tab.id, $event)"
        @dragleave="onDragLeave(tab.id)"
        @drop="onDrop(tab.id, $event)"
        @dragend="onDragEnd"
      >
        <span class="dot" v-if="!tab.isSaved" />
        <span class="label">{{ tab.filename }}</span>
        <button class="close" @click="close(tab.id, $event)" :aria-label="t('tabs.closeTab')">
          <el-icon :size="12"><Close /></el-icon>
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
  height: 34px;
  background: #f5f6f7;
  border-bottom: 1px solid #eaecef;
  flex-shrink: 0;
}
.tabs-scroll {
  display: flex;
  overflow-x: auto;
  flex: 1;
}
.tabs-scroll::-webkit-scrollbar { height: 3px; }
.tabs-scroll::-webkit-scrollbar-thumb { background: #d1d5da; }

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  height: 100%;
  border-right: 1px solid #eaecef;
  cursor: pointer;
  font-size: 12px;
  color: #586069;
  white-space: nowrap;
  min-width: 100px;
  max-width: 240px;
  position: relative;
  transition: background-color 100ms;
}
.tab:hover { background: #ebedef; }
.tab.active {
  background: #fff;
  color: #24292e;
  border-bottom: 2px solid var(--mt-accent, #0366d6);
}
.tab.dragging { opacity: 0.5; }
.tab.drop-target { box-shadow: inset 3px 0 0 var(--mt-accent, #0366d6); }
.tab .label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab .dot {
  width: 6px;
  height: 6px;
  background: #fb8c00;
  border-radius: 50%;
}
.tab .close {
  border: none;
  background: transparent;
  color: #959da5;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  opacity: 0;
  transition: opacity 100ms;
}
.tab:hover .close,
.tab.active .close { opacity: 1; }
.tab .close:hover { background: #d1d5da; color: #24292e; }

.new-tab {
  border: none;
  background: transparent;
  color: #586069;
  cursor: pointer;
  width: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.new-tab:hover { background: #ebedef; }
</style>
