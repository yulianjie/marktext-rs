<script setup lang="ts">
/**
 * Title bar — shows the active file as a clickable breadcrumb path, dirty
 * indicator, and a multi-stat word-count chip (paragraphs / words /
 * characters) shown as a tooltip on hover.
 *
 * Mirrors the upstream Electron build's title bar (file path is broken into
 * segments; clicking a segment navigates the sidebar to that directory).
 * Window controls (min/max/close) come from the native OS chrome
 * (tauri.conf.json `decorations: true`); no custom buttons here.
 */
import { computed } from 'vue'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { open as openShell } from '@tauri-apps/plugin-shell'
import { useEditorStore } from '@/stores/editor'
import { useI18n } from '@/i18n'

const editor = useEditorStore()
const { t } = useI18n()

interface Segment {
  label: string
  fullPath: string
}

/** Split a pathname into clickable segments, normalising Windows backslashes. */
const segments = computed<Segment[]>(() => {
  const f = editor.currentFile
  if (!f?.pathname) return []
  const norm = f.pathname.replace(/\\/g, '/')
  const parts = norm.split('/').filter(Boolean)
  let acc = norm.startsWith('/') ? '' : ''
  const out: Segment[] = []
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : (norm.startsWith('/') ? `/${p}` : p)
    out.push({ label: p, fullPath: acc })
  }
  return out
})

const isDirty = computed(() => editor.currentFile && !editor.currentFile.isSaved)
const displayName = computed(() => editor.currentFile?.filename || t('titleBar.untitled'))

const stats = computed(() => {
  const wc = editor.currentFile?.wordCount
  return {
    words: wc?.word ?? 0,
    characters: wc?.character ?? 0,
    paragraphs: wc?.paragraph ?? 0,
  }
})

const tooltip = computed(() => {
  const { paragraphs, words, characters } = stats.value
  return [
    `${paragraphs} ${t('titleBar.paragraphs')}`,
    `${words} ${t('titleBar.words')}`,
    `${characters} ${t('titleBar.characters')}`,
  ].join('  ·  ')
})

async function copyFullPath() {
  const p = editor.currentFile?.pathname
  if (p) await writeText(p)
}

async function revealSegment(seg: Segment) {
  try { await openShell(seg.fullPath) } catch { /* not a directory or no app */ }
}
</script>

<template>
  <header class="title-bar" data-tauri-drag-region>
    <div class="title-content" data-tauri-drag-region>
      <span v-if="isDirty" class="dirty-dot" data-tauri-drag-region>●</span>
      <template v-if="segments.length > 1">
        <span class="breadcrumb" data-tauri-drag-region>
          <template v-for="(seg, i) in segments" :key="seg.fullPath">
            <span
              class="bc-seg"
              :class="{ active: i === segments.length - 1 }"
              :title="seg.fullPath"
              @dblclick="copyFullPath"
              @click="revealSegment(seg)"
            >{{ seg.label }}</span>
            <span v-if="i < segments.length - 1" class="bc-sep" data-tauri-drag-region>›</span>
          </template>
        </span>
      </template>
      <span v-else class="title-text" data-tauri-drag-region>{{ displayName }}</span>
    </div>
    <span class="word-count" :title="tooltip" data-tauri-drag-region>
      {{ stats.words }} {{ t('titleBar.words') }}
    </span>
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
  gap: 8px;
  padding: 0 12px;
  flex: 1;
  overflow: hidden;
  min-width: 0;
}
.dirty-dot {
  color: #0366d6;
  font-size: 10px;
  line-height: 1;
}
.title-text {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  overflow: hidden;
  min-width: 0;
}
.bc-seg {
  cursor: pointer;
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
}
.bc-seg:hover { color: #0366d6; }
.bc-seg.active {
  font-weight: 600;
  color: #24292e;
  flex-shrink: 0;
}
.bc-sep {
  color: #d1d5da;
  flex-shrink: 0;
}
.word-count {
  color: #959da5;
  font-size: 11px;
  margin-left: auto;
  padding: 0 12px;
  cursor: help;
}
</style>
