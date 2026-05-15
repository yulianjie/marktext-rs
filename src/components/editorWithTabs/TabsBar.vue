<script setup lang="ts">
/**
 * Tab bar — one row of file tabs above the editor.
 *
 * Click a tab to activate it. Middle-click or × button to close.
 * Drag-to-reorder is intentionally deferred to a follow-up (would pull in
 * dragula + dom-autoscroller; not worth the dependency bump for spike).
 */
import { useEditorStore } from '@/stores/editor'
import { Close, Plus } from '@element-plus/icons-vue'

const editor = useEditorStore()

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
</script>

<template>
  <div class="tabs-bar">
    <div class="tabs-scroll">
      <div
        v-for="tab in editor.tabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.id === editor.currentFileId, dirty: !tab.isSaved }"
        :title="tab.pathname || tab.filename"
        @click="activate(tab.id)"
        @mousedown.middle="onMiddleClick(tab.id, $event)"
      >
        <span class="dot" v-if="!tab.isSaved" />
        <span class="label">{{ tab.filename }}</span>
        <button class="close" @click="close(tab.id, $event)" aria-label="Close tab">
          <el-icon :size="12"><Close /></el-icon>
        </button>
      </div>
    </div>
    <button class="new-tab" @click="newTab" aria-label="New tab">
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
