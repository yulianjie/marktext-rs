<script setup lang="ts">
/**
 * Title bar — shows the active file as a compact, keyboard-accessible
 * breadcrumb path and a non-colour-only dirty indicator.
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

async function copyFullPath() {
  const p = editor.currentFile?.pathname
  if (p) await writeText(p)
}

function parentDirOf(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index > 0 ? path.slice(0, index) : path
}

async function revealSegment(seg: Segment, index: number) {
  const isFile = index === segments.value.length - 1
  const target = isFile ? parentDirOf(seg.fullPath) : seg.fullPath
  try { await openShell(target) } catch { /* not a directory or no app */ }
}
</script>

<template>
  <header class="title-bar" data-tauri-drag-region>
    <div class="title-content" data-tauri-drag-region>
      <span v-if="isDirty" class="dirty-dot" aria-hidden="true" data-tauri-drag-region>●</span>
      <template v-if="segments.length > 1">
        <nav class="breadcrumb" :aria-label="displayName">
          <template v-for="(seg, i) in segments" :key="seg.fullPath">
            <button
              type="button"
              class="bc-seg"
              :class="{ active: i === segments.length - 1 }"
              :title="i === segments.length - 1
                ? `${t('titleBar.revealInFolder')} · ${seg.fullPath}`
                : seg.fullPath"
              :aria-current="i === segments.length - 1 ? 'page' : undefined"
              @dblclick.stop="copyFullPath"
              @click="revealSegment(seg, i)"
            >
              {{ seg.label }}
            </button>
            <span v-if="i < segments.length - 1" class="bc-sep" data-tauri-drag-region>›</span>
          </template>
        </nav>
      </template>
      <span v-else class="title-text" :title="displayName" data-tauri-drag-region>{{ displayName }}</span>
    </div>
  </header>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  background: var(--mt-sidebar-bg, #fafbfc);
  border-bottom: 1px solid var(--mt-border, #eaecef);
  user-select: none;
  font-size: 12px;
  color: var(--mt-fg-muted, #586069);
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
  color: var(--mt-accent, #0366d6);
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
  appearance: none;
  border: 0;
  border-radius: 4px;
  padding: 2px 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  text-align: left;
}
.bc-seg:hover {
  color: var(--mt-fg, #24292e);
  background: var(--mt-row-hover, #f1f3f5);
}
.bc-seg:focus-visible {
  outline: 2px solid var(--mt-accent, #0366d6);
  outline-offset: 1px;
}
.bc-seg.active {
  font-weight: 600;
  color: var(--mt-fg, #24292e);
  background: color-mix(in srgb, var(--mt-accent, #0366d6) 8%, transparent);
  flex-shrink: 0;
}
.bc-sep {
  color: var(--mt-fg-muted, #6a737d);
  opacity: 0.58;
  flex-shrink: 0;
}

@media (max-width: 900px) {
  .bc-seg:not(.active) { max-width: 84px; }
}
</style>
