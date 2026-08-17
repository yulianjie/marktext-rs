<script setup lang="ts">
/**
 * Sidebar — icon rail (40px) on the left, optional content panel on the
 * right. Clicking an active icon collapses to just-the-rail; clicking
 * another icon switches the panel.
 *
 * Resizing the panel is a drag on the right edge, tracked through
 * pointermove/pointerup.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { Folder, Compass, Search, Setting } from '@element-plus/icons-vue'
import { useLayoutStore, type RightColumn } from '@/stores/layout'
import { openSettings } from '@/services/tauri-invoke'
import { useI18n } from '@/i18n'
import TreePane from './TreePane.vue'
import TocPane from './TocPane.vue'
import SearchPane from './SearchPane.vue'

const layout = useLayoutStore()
const { t } = useI18n()

const panelWidth = computed(() => layout.sideBarWidth)
const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 800
const KEYBOARD_RESIZE_STEP = 16

interface RailItem { key: RightColumn; icon: typeof Folder; titleKey: string }
const rails: RailItem[] = [
  { key: 'files', icon: Folder, titleKey: 'sideBar.files' },
  { key: 'toc', icon: Compass, titleKey: 'sideBar.toc' },
  { key: 'search', icon: Search, titleKey: 'sideBar.search' },
]

function switchTo(key: RightColumn) {
  if (layout.rightColumn === key) layout.setLayout({ rightColumn: '' })
  else layout.setLayout({ rightColumn: key })
}

/* ── resize drag ─────────────────────────────────────────────── */
const dragging = ref(false)
let stopResize: (() => void) | null = null

function endResize() {
  stopResize?.()
  stopResize = null
  dragging.value = false
}

function onResizeDown(ev: PointerEvent) {
  if (ev.button !== 0) return
  ev.preventDefault()
  endResize()
  dragging.value = true
  const start = ev.clientX
  const initial = layout.sideBarWidth
  const onMove = (m: PointerEvent) => layout.setSideBarWidth(initial + (m.clientX - start))
  const onUp = () => endResize()
  stopResize = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onResizeKeydown(ev: KeyboardEvent) {
  const step = ev.shiftKey ? KEYBOARD_RESIZE_STEP * 3 : KEYBOARD_RESIZE_STEP
  if (ev.key === 'ArrowLeft') {
    ev.preventDefault()
    layout.setSideBarWidth(layout.sideBarWidth - step)
  } else if (ev.key === 'ArrowRight') {
    ev.preventDefault()
    layout.setSideBarWidth(layout.sideBarWidth + step)
  } else if (ev.key === 'Home') {
    ev.preventDefault()
    layout.setSideBarWidth(SIDEBAR_MIN)
  } else if (ev.key === 'End') {
    ev.preventDefault()
    layout.setSideBarWidth(SIDEBAR_MAX)
  }
}

onBeforeUnmount(endResize)
</script>

<template>
  <aside class="side-bar">
    <div class="rail">
      <button
        v-for="item in rails"
        :key="item.key"
        type="button"
        class="rail-icon"
        :class="{ active: layout.rightColumn === item.key }"
        :title="t(item.titleKey)"
        :aria-label="t(item.titleKey)"
        :aria-pressed="layout.rightColumn === item.key"
        :aria-expanded="layout.rightColumn === item.key"
        :aria-controls="`${item.key}-sidebar-panel`"
        @click="switchTo(item.key)"
      >
        <el-icon :size="18"><component :is="item.icon" /></el-icon>
      </button>
      <div class="spacer" />
      <button
        type="button"
        class="rail-icon"
        :title="t('sideBar.preferences')"
        :aria-label="t('sideBar.preferences')"
        @click="openSettings"
      >
        <el-icon :size="18"><Setting /></el-icon>
      </button>
    </div>
    <div
      v-if="layout.rightColumn"
      :id="`${layout.rightColumn}-sidebar-panel`"
      class="panel"
      :style="{ width: panelWidth + 'px' }"
    >
      <TreePane v-if="layout.rightColumn === 'files'" />
      <TocPane v-else-if="layout.rightColumn === 'toc'" />
      <SearchPane v-else-if="layout.rightColumn === 'search'" />
      <div v-else class="placeholder" />
      <div
        class="resizer"
        :class="{ dragging }"
        role="separator"
        aria-orientation="vertical"
        :aria-label="`${t('sideBar.files')} · ${panelWidth}px`"
        :aria-valuemin="SIDEBAR_MIN"
        :aria-valuemax="SIDEBAR_MAX"
        :aria-valuenow="panelWidth"
        tabindex="0"
        @keydown="onResizeKeydown"
        @pointerdown="onResizeDown"
      />
    </div>
  </aside>
</template>

<style scoped>
.side-bar {
  display: flex;
  height: 100%;
  flex-shrink: 0;
  border-right: 1px solid var(--mt-border);
}
.rail {
  width: 45px;
  background: var(--mt-sidebar-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0;
  gap: 6px;
  border-right: 1px solid var(--mt-border);
}
.spacer { flex: 1; }
.rail-icon {
  box-sizing: border-box;
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  color: var(--mt-fg-muted);
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 120ms, color 120ms, box-shadow 120ms;
}
.rail-icon:hover {
  background: var(--mt-row-hover);
  color: var(--mt-fg);
}
.rail-icon.active {
  background: color-mix(in srgb, var(--mt-accent) 11%, transparent);
  color: var(--mt-accent);
  box-shadow: inset 2px 0 0 var(--mt-accent);
}
.rail-icon:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--mt-accent) 72%, transparent);
  outline-offset: 1px;
}

.panel {
  position: relative;
  background: var(--mt-sidebar-bg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: inset -1px 0 0 color-mix(in srgb, var(--mt-border) 72%, transparent);
}
.placeholder {
  padding: 24px 16px;
  color: var(--mt-fg-muted);
  font-size: 13px;
  text-align: center;
}
.resizer {
  position: absolute;
  right: -2px;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: ew-resize;
  background: transparent;
  z-index: 1;
}
.resizer:hover,
.resizer.dragging { background: var(--mt-accent); opacity: 0.4; }
.resizer:focus-visible {
  width: 5px;
  right: -3px;
  background: var(--mt-accent);
  opacity: 0.65;
  outline: none;
}
</style>
