<script setup lang="ts">
/**
 * Title bar — shows the active file path, dirty indicator, and word count.
 * Window controls (min/max/close) come from the native OS chrome
 * (tauri.conf.json `decorations: true`); no custom buttons here.
 */
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { useI18n } from '@/i18n'

const editor = useEditorStore()
const { t } = useI18n()

const titleText = computed(() => {
  const f = editor.currentFile
  if (!f) return t('app.name')
  const star = f.isSaved ? '' : '● '
  return star + (f.pathname || f.filename)
})

const wordCount = computed(() => editor.currentFile?.wordCount.word ?? 0)
</script>

<template>
  <header class="title-bar" data-tauri-drag-region>
    <div class="title-content" data-tauri-drag-region>
      <span class="title-text" data-tauri-drag-region>{{ titleText }}</span>
      <span class="word-count" data-tauri-drag-region>{{ wordCount }} {{ t('titleBar.words') }}</span>
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
</style>
