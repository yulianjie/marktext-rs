<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import { Close, Document } from '@element-plus/icons-vue'
import type { DocumentState } from '@/stores/help'
import { bus } from '@/bus'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { t } from '@/i18n'

interface Props {
  tab: DocumentState
  active: boolean
}
const props = defineProps<Props>()

const editor = useEditorStore()

function activate() { editor.setCurrent(props.tab.id) }
function close(ev: MouseEvent) { ev.stopPropagation(); editor.closeTab(props.tab.id) }
function onMiddle(ev: MouseEvent) { if (ev.button === 1) { ev.preventDefault(); editor.closeTab(props.tab.id) } }

function parentDirOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(0, idx) : p
}

function onContextMenu(ev: MouseEvent) {
  ev.preventDefault()
  ev.stopPropagation()
  const id = props.tab.id
  bus.emit('openContextMenu', {
    x: ev.clientX,
    y: ev.clientY,
    items: [
      { label: t('tabs.closeTab'), action: () => editor.closeTab(id) },
      { label: t('tabs.closeOthers'), action: () => {
        for (const tt of [...editor.tabs]) if (tt.id !== id) editor.closeTab(tt.id)
      } },
      { label: t('tabs.closeAll'), action: () => {
        for (const tt of [...editor.tabs]) editor.closeTab(tt.id)
      } },
      { divider: true },
      { label: t('tabs.rename'), action: () => { editor.setCurrent(id); bus.emit('rename', undefined) } },
      { label: t('tabs.copyPath'), disabled: !props.tab.pathname, action: async () => {
        if (props.tab.pathname) await writeText(props.tab.pathname)
      } },
      { label: t('tabs.showInFolder'), disabled: !props.tab.pathname, action: async () => {
        if (props.tab.pathname) await shellOpen(parentDirOf(props.tab.pathname))
      } },
    ],
  })
}
</script>

<template>
  <div
    class="row"
    :class="{ active, dirty: !tab.isSaved }"
    :title="tab.pathname || tab.filename"
    @click="activate"
    @mousedown.middle="onMiddle"
    @contextmenu="onContextMenu"
  >
    <span class="indicator">
      <span class="dot" />
      <button class="close" @click="close" :aria-label="t('tabs.closeTab')">
        <el-icon :size="10"><Close /></el-icon>
      </button>
    </span>
    <el-icon class="icon"><Document /></el-icon>
    <span class="name">{{ tab.filename }}</span>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  cursor: pointer;
  font-size: 12px;
  color: var(--mt-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row:hover { background: var(--mt-row-hover); }
.row.active {
  box-shadow: inset 2px 0 0 var(--mt-accent);
  color: var(--mt-accent);
}
.indicator {
  width: 12px;
  height: 12px;
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dot {
  display: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mt-accent);
}
.close {
  display: none;
  border: none;
  background: transparent;
  color: var(--mt-fg-muted);
  cursor: pointer;
  padding: 0;
  width: 12px;
  height: 12px;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
}
.close:hover { color: var(--mt-fg); background: var(--mt-row-hover); }

/* Saved tabs: show close on row hover. */
.row:not(.dirty):hover .close { display: inline-flex; }

/* Dirty tabs: show dot by default; swap to close on hover. */
.row.dirty .dot { display: inline-block; }
.row.dirty:hover .dot { display: none; }
.row.dirty:hover .close { display: inline-flex; }

.icon {
  color: var(--mt-fg-muted);
  font-size: 14px;
  flex-shrink: 0;
}
.row.active .icon { color: var(--mt-accent); }
.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
