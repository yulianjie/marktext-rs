<script setup lang="ts">
/**
 * Title bar — shows the active file path, dirty indicator, and window
 * controls. Replaces the Electron `BrowserWindow` chrome (custom frame).
 */
import { computed } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEditorStore } from '@/stores/editor'
import { usePreferencesStore } from '@/stores/preferences'

const editor = useEditorStore()
const prefs = usePreferencesStore()
const win = getCurrentWindow()

const titleText = computed(() => {
  const f = editor.currentFile
  if (!f) return 'MarkText'
  const star = f.isSaved ? '' : '● '
  return star + (f.pathname || f.filename)
})

const wordCount = computed(() => editor.currentFile?.wordCount.word ?? 0)
const useCustomChrome = computed(() => prefs.titleBarStyle === 'custom')

async function minimize() { await win.minimize() }
async function toggleMax() {
  const m = await win.isMaximized()
  if (m) await win.unmaximize()
  else await win.maximize()
}
async function close() { await win.close() }
</script>

<template>
  <header class="title-bar" :class="{ 'custom-chrome': useCustomChrome }" data-tauri-drag-region>
    <div class="title-content" data-tauri-drag-region>
      <span class="title-text" data-tauri-drag-region>{{ titleText }}</span>
      <span class="word-count" data-tauri-drag-region>{{ wordCount }} words</span>
    </div>
    <div v-if="useCustomChrome" class="window-controls">
      <button class="ctl" aria-label="Minimize" @click="minimize">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5 L10 5" stroke="currentColor" stroke-width="1" /></svg>
      </button>
      <button class="ctl" aria-label="Maximize" @click="toggleMax">
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" stroke="currentColor" stroke-width="1" fill="none" /></svg>
      </button>
      <button class="ctl close" aria-label="Close" @click="close">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" stroke-width="1" /></svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  background: #fafbfc;
  border-bottom: 1px solid #eaecef;
  user-select: none;
  font-size: 12px;
  color: #586069;
}
.title-content {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 12px;
  flex: 1;
  overflow: hidden;
}
.title-text {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.word-count {
  color: #959da5;
  font-size: 11px;
  margin-left: auto;
}
.window-controls {
  display: flex;
}
.ctl {
  width: 46px;
  height: 32px;
  border: none;
  background: transparent;
  color: #586069;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ctl:hover { background: #eaecef; }
.ctl.close:hover { background: #e81123; color: #fff; }
</style>
