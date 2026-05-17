<script setup lang="ts">
/**
 * TOC pane — shows the heading tree of the active document.
 */
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editor'
import type { TocItem } from '@/stores/editor'
import { t } from '@/i18n'

const editor = useEditorStore()

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
      <div
        v-for="(item, idx) in flat"
        :key="idx"
        class="toc-row"
        :style="{ paddingLeft: (4 + (item.level - 1) * 12) + 'px' }"
        :title="item.content"
        @click="scrollTo(item)"
      >
        {{ item.content }}
      </div>
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
  color: #24292e;
  border-bottom: 1px solid #eaecef;
  letter-spacing: 0.04em;
}
.toc-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.toc-row {
  font-size: 12px;
  height: 22px;
  display: flex;
  align-items: center;
  padding-right: 12px;
  cursor: pointer;
  color: #586069;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toc-row:hover { background: #f1f3f5; color: #24292e; }
.empty {
  padding: 16px 12px;
  color: #959da5;
  font-size: 12px;
  text-align: center;
}
</style>
