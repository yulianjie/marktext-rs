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
function onResizeDown(ev: PointerEvent) {
  dragging.value = true
  const start = ev.clientX
  const initial = layout.sideBarWidth
  const onMove = (m: PointerEvent) => layout.setSideBarWidth(initial + (m.clientX - start))
  const onUp = () => {
    dragging.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

onBeforeUnmount(() => { dragging.value = false })
</script>

<template>
  <aside class="side-bar">
    <div class="rail">
      <button
        v-for="item in rails"
        :key="item.key"
        class="rail-icon"
        :class="{ active: layout.rightColumn === item.key }"
        :title="t(item.titleKey)"
        @click="switchTo(item.key)"
      >
        <el-icon :size="18"><component :is="item.icon" /></el-icon>
      </button>
      <div class="spacer" />
      <button class="rail-icon" :title="t('sideBar.preferences')" @click="openSettings">
        <el-icon :size="18"><Setting /></el-icon>
      </button>
    </div>
    <div
      v-if="layout.rightColumn"
      class="panel"
      :style="{ width: panelWidth + 'px' }"
    >
      <TreePane v-if="layout.rightColumn === 'files'" />
      <TocPane v-else-if="layout.rightColumn === 'toc'" />
      <SearchPane v-else-if="layout.rightColumn === 'search'" />
      <div v-else class="placeholder" />
      <div class="resizer" :class="{ dragging }" @pointerdown="onResizeDown" />
    </div>
  </aside>
</template>

<style scoped>
.side-bar {
  display: flex;
  height: 100%;
  flex-shrink: 0;
  border-right: 1px solid #eaecef;
}
.rail {
  width: 40px;
  background: #f5f6f7;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 4px;
  border-right: 1px solid #eaecef;
}
.spacer { flex: 1; }
.rail-icon {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #586069;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rail-icon:hover { background: #ebedef; color: #24292e; }
.rail-icon.active { background: #e1ecf4; color: #0366d6; }

.panel {
  position: relative;
  background: #fafbfc;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.placeholder {
  padding: 24px 16px;
  color: #959da5;
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
.resizer.dragging { background: rgba(3, 102, 214, 0.4); }
</style>
