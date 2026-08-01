<script setup lang="ts">
/**
 * TOC pane — shows the heading tree of the active document.
 */
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { usePreferencesStore } from '@/stores/preferences'
import type { TocItem } from '@/stores/editor'
import { t } from '@/i18n'

const editor = useEditorStore()
const prefs = usePreferencesStore()

interface FlatItem {
  level: number
  content: string
  slug?: string
}

// Flatten TOC tree so we can render with `v-for` and indent by level.
function flatten(items: TocItem[], out: FlatItem[] = []): FlatItem[] {
  for (const it of items) {
    out.push({ level: it.level, content: it.content, slug: it.slug })
    if (it.children?.length) flatten(it.children, out)
  }
  return out
}

const flat = computed(() => flatten(editor.toc))

function scrollTo(item: FlatItem) {
  if (!item.slug) return
  const target = document.getElementById(item.slug)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="toc-pane">
    <div class="toc-header">{{ t('sideBar.toc') }}</div>
    <div class="toc-list">
      <button
        v-for="(item, idx) in flat"
        :key="idx"
        type="button"
        class="toc-row"
        :class="{ wrap: prefs.wordWrapInToc }"
        :style="{ paddingLeft: (4 + (item.level - 1) * 12) + 'px' }"
        :title="item.content"
        @click="scrollTo(item)"
      >
        {{ item.content }}
      </button>
      <div v-if="!flat.length" class="empty">{{ t('sideBar.noHeadings') }}</div>
    </div>
  </div>
</template>

<style scoped>
.toc-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.toc-header {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--mt-fg, #24292e);
  border-bottom: 1px solid var(--mt-border, #eaecef);
  letter-spacing: 0.04em;
}
.toc-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.toc-row {
  font-size: 12px;
  height: 22px;
  display: flex;
  align-items: center;
  padding-right: 12px;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--mt-fg-muted, #586069);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toc-row:hover { background: var(--mt-row-hover, #f1f3f5); color: var(--mt-fg, #24292e); }
.toc-row:focus-visible { outline: 2px solid var(--mt-accent, #0366d6); outline-offset: -2px; }
.toc-row.wrap {
  height: auto;
  min-height: 22px;
  align-items: flex-start;
  padding-top: 3px;
  padding-bottom: 3px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.empty {
  padding: 16px 12px;
  color: var(--mt-fg-muted, #959da5);
  font-size: 12px;
  text-align: center;
}
</style>
