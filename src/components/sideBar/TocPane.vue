<script setup lang="ts">
/**
 * TOC pane — shows the heading tree of the active document.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { usePreferencesStore } from '@/stores/preferences'
import type { TocItem } from '@/stores/editor'
import { t } from '@/i18n'

const editor = useEditorStore()
const prefs = usePreferencesStore()
const activeSlug = ref<string | null>(null)
const rowRefs = new Map<string, HTMLButtonElement>()
let scrollHost: HTMLElement | null = null
let scrollFrame = 0

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

function itemKey(item: FlatItem, index: number): string {
  return item.slug || `${item.level}:${item.content}:${index}`
}

function setRowRef(item: FlatItem, index: number, element: unknown) {
  const key = itemKey(item, index)
  if (element instanceof HTMLButtonElement) rowRefs.set(key, element)
  else rowRefs.delete(key)
}

function visualLevel(level: number): number {
  return Math.min(Math.max(level, 1), 6)
}

function rowIndent(level: number): string {
  return `${10 + (visualLevel(level) - 1) * 16}px`
}

function scrollTo(item: FlatItem) {
  if (!item.slug) return
  activeSlug.value = item.slug
  const target = document.getElementById(item.slug)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function updateActiveHeading() {
  scrollFrame = 0
  const headings = flat.value.filter((item): item is FlatItem & { slug: string } => Boolean(item.slug))
  if (!headings.length) {
    activeSlug.value = null
    return
  }
  const threshold = (scrollHost?.getBoundingClientRect().top ?? 0) + 56
  let current = headings[0].slug
  for (const item of headings) {
    const element = document.getElementById(item.slug)
    if (!element) continue
    if (element.getBoundingClientRect().top <= threshold) current = item.slug
    else break
  }
  activeSlug.value = current
}

function scheduleActiveHeadingUpdate() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(updateActiveHeading)
}

function connectScrollHost() {
  scrollHost?.removeEventListener('scroll', scheduleActiveHeadingUpdate)
  scrollHost = document.querySelector<HTMLElement>('.muya-host')
  scrollHost?.addEventListener('scroll', scheduleActiveHeadingUpdate, { passive: true })
  scheduleActiveHeadingUpdate()
}

function focusRow(index: number) {
  const item = flat.value[index]
  if (!item) return
  rowRefs.get(itemKey(item, index))?.focus()
}

function onRowKeydown(index: number, ev: KeyboardEvent) {
  let target = index
  if (ev.key === 'ArrowDown') target = Math.min(index + 1, flat.value.length - 1)
  else if (ev.key === 'ArrowUp') target = Math.max(index - 1, 0)
  else if (ev.key === 'Home') target = 0
  else if (ev.key === 'End') target = flat.value.length - 1
  else return
  ev.preventDefault()
  focusRow(target)
}

watch([flat, () => editor.currentFileId], async () => {
  await nextTick()
  connectScrollHost()
}, { flush: 'post' })

watch(activeSlug, async slug => {
  if (!slug) return
  await nextTick()
  const index = flat.value.findIndex(item => item.slug === slug)
  const item = flat.value[index]
  if (item) rowRefs.get(itemKey(item, index))?.scrollIntoView({ block: 'nearest' })
})

onMounted(async () => {
  await nextTick()
  connectScrollHost()
})

onBeforeUnmount(() => {
  scrollHost?.removeEventListener('scroll', scheduleActiveHeadingUpdate)
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
})
</script>

<template>
  <div class="toc-pane">
    <div class="toc-header">{{ t('sideBar.toc') }}</div>
    <div class="toc-list">
      <button
        v-for="(item, idx) in flat"
        :key="itemKey(item, idx)"
        :ref="element => setRowRef(item, idx, element)"
        type="button"
        class="toc-row"
        :class="[
          `level-${visualLevel(item.level)}`,
          { wrap: prefs.wordWrapInToc, current: item.slug && item.slug === activeSlug },
        ]"
        :style="{ paddingInlineStart: rowIndent(item.level) }"
        :title="item.content"
        :aria-label="`H${item.level}: ${item.content}`"
        :aria-current="item.slug && item.slug === activeSlug ? 'location' : undefined"
        :tabindex="item.slug === activeSlug || (!activeSlug && idx === 0) ? 0 : -1"
        @click="scrollTo(item)"
        @keydown="onRowKeydown(idx, $event)"
      >
        <span class="toc-marker" aria-hidden="true" />
        <span class="toc-label">{{ item.content }}</span>
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
  box-sizing: border-box;
  display: flex;
  align-items: center;
  min-height: 38px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 650;
  color: var(--mt-fg, #24292e);
  border-bottom: 1px solid var(--mt-border, #eaecef);
  letter-spacing: 0.02em;
}
.toc-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 7px 16px;
}
.toc-row {
  box-sizing: border-box;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-inline-end: 10px;
  width: 100%;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--mt-fg-muted, #586069);
  font-family: inherit;
  line-height: 18px;
  transition: background-color 120ms, color 120ms;
}
.toc-row.level-1 {
  margin-top: 5px;
  color: var(--mt-fg, #24292e);
  font-size: 14px;
  font-weight: 650;
}
.toc-row.level-1:first-child { margin-top: 0; }
.toc-row.level-2 {
  color: color-mix(in srgb, var(--mt-fg, #24292e) 90%, transparent);
  font-size: 13.5px;
  font-weight: 600;
}
.toc-row.level-3 {
  font-size: 13px;
  font-weight: 450;
}
.toc-row.level-4,
.toc-row.level-5,
.toc-row.level-6 {
  font-size: 12.5px;
  font-weight: 400;
  color: color-mix(in srgb, var(--mt-fg-muted, #586069) 82%, transparent);
}
.toc-row:hover {
  background: color-mix(in srgb, var(--mt-accent, #21b56f) 9%, transparent);
  color: var(--mt-fg, #24292e);
}
.toc-row.current {
  color: var(--mt-fg, #24292e);
  background: color-mix(in srgb, var(--mt-accent, #21b56f) 13%, transparent);
  box-shadow: inset 3px 0 0 var(--mt-accent, #21b56f);
}
.toc-row.current .toc-marker {
  color: var(--mt-accent, #21b56f);
  opacity: 1;
}
.toc-row:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--mt-accent, #0366d6) 72%, transparent);
  outline-offset: -2px;
}
.toc-marker {
  width: 4px;
  height: 4px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.35;
}
.level-1 .toc-marker {
  width: 3px;
  height: 16px;
  border-radius: 999px;
  background: var(--mt-accent, #21b56f);
  opacity: 1;
}
.level-2 .toc-marker {
  width: 6px;
  height: 6px;
  opacity: 0.68;
}
.level-3 .toc-marker {
  box-sizing: border-box;
  width: 6px;
  height: 6px;
  border: 1.5px solid currentColor;
  background: transparent;
  opacity: 0.58;
}
.level-4 .toc-marker,
.level-5 .toc-marker,
.level-6 .toc-marker {
  width: 5px;
  height: 2px;
  border-radius: 1px;
  opacity: 0.42;
}
.toc-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.toc-row.wrap {
  height: auto;
  min-height: 30px;
  align-items: flex-start;
  padding-top: 6px;
  padding-bottom: 6px;
}
.toc-row.wrap .toc-marker { margin-top: 6px; }
.toc-row.wrap .toc-label {
  white-space: normal;
  overflow-wrap: anywhere;
}
.empty {
  padding: 24px 12px;
  color: var(--mt-fg-muted, #959da5);
  font-size: 13px;
  text-align: center;
}
</style>
