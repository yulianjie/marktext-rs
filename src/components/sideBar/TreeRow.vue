<script setup lang="ts">
/**
 * Recursive tree row — renders a file or folder. Folders expand/collapse
 * on click; files emit `select` which the parent forwards to the editor.
 */
import { computed } from 'vue'
import type { TreeFile, TreeFolder } from '@/stores/treeCtrl'
import { CaretRight, Document, Folder } from '@element-plus/icons-vue'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { useNotificationStore } from '@/stores/notification'
import { trashFile } from '@/services/tauri-invoke'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { bus } from '@/bus'
import { t } from '@/i18n'

interface Props {
  node: TreeFolder | TreeFile
  depth: number
}
const props = defineProps<Props>()
const emit = defineEmits<{ (e: 'select', file: TreeFile): void }>()

const project = useProjectStore()
const editor = useEditorStore()
const notify = useNotificationStore()

const isFolder = computed(() => props.node.isDirectory)
const folder = computed(() => (isFolder.value ? (props.node as TreeFolder) : null))
const padding = computed(() => 8 + props.depth * 20 + 'px')

function toggle() {
  if (folder.value) folder.value.isCollapsed = !folder.value.isCollapsed
}

function pickFile(file: TreeFile) {
  project.setActiveItem({ pathname: file.pathname, isDirectory: false })
  emit('select', file)
}

function parentDirOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(0, idx) : p
}

async function trashAndCloseTab(path: string) {
  try {
    await trashFile(path)
    const tab = editor.tabs.find(t => t.pathname === path)
    if (tab) void editor.closeTab(tab.id, true)
  } catch (err) {
    notify.pushToast({
      type: 'error',
      title: t('toast.openFailed'),
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

function fileMenu(file: TreeFile, ev: MouseEvent) {
  ev.preventDefault()
  ev.stopPropagation()
  bus.emit('openContextMenu', {
    x: ev.clientX,
    y: ev.clientY,
    items: [
      { label: t('tree.openFile'), action: () => pickFile(file) },
      { divider: true },
      { label: t('tabs.copyPath'), action: () => { void writeText(file.pathname) } },
      { label: t('tabs.showInFolder'), action: () => { void shellOpen(parentDirOf(file.pathname)) } },
      { divider: true },
      { label: t('tree.deleteFile'), action: () => { void trashAndCloseTab(file.pathname) } },
    ],
  })
}

function folderMenu(f: TreeFolder, ev: MouseEvent) {
  ev.preventDefault()
  ev.stopPropagation()
  bus.emit('openContextMenu', {
    x: ev.clientX,
    y: ev.clientY,
    items: [
      { label: t('tabs.copyPath'), action: () => { void writeText(f.pathname) } },
      { label: t('tabs.showInFolder'), action: () => { void shellOpen(f.pathname) } },
    ],
  })
}
</script>

<template>
  <div v-if="isFolder">
    <div class="row" :style="{ paddingLeft: padding }" @click="toggle" @contextmenu="folderMenu(folder!, $event)">
      <el-icon class="caret" :class="{ open: !folder!.isCollapsed }"><CaretRight /></el-icon>
      <el-icon class="icon folder"><Folder /></el-icon>
      <span class="name">{{ folder!.name }}</span>
    </div>
    <div v-show="!folder!.isCollapsed">
      <TreeRow
        v-for="child in folder!.folders"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        @select="(f: TreeFile) => emit('select', f)"
      />
      <TreeRow
        v-for="file in folder!.files"
        :key="file.id"
        :node="file"
        :depth="depth + 1"
        @select="(f: TreeFile) => emit('select', f)"
      />
    </div>
  </div>
  <div
    v-else
    class="row file"
    :class="{ active: project.activeItem?.pathname === (node as TreeFile).pathname }"
    :style="{ paddingLeft: padding }"
    :title="(node as TreeFile).pathname"
    @click="pickFile(node as TreeFile)"
    @contextmenu="fileMenu(node as TreeFile, $event)"
  >
    <span class="caret-spacer" />
    <el-icon class="icon file-icon"><Document /></el-icon>
    <span class="name">{{ (node as TreeFile).name }}</span>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding-right: 8px;
  cursor: pointer;
  font-size: 13px;
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
.caret {
  transition: transform 100ms;
  color: var(--mt-fg-muted);
  font-size: 10px;
}
.caret.open { transform: rotate(90deg); }
.caret-spacer { width: 10px; display: inline-block; }
.icon {
  color: var(--mt-fg-muted);
  font-size: 14px;
  flex-shrink: 0;
}
.icon.folder { color: #f6c344; }
.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
