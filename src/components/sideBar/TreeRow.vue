<script setup lang="ts">
/**
 * Recursive tree row — renders a file or folder. Folders expand/collapse
 * on click; files emit `select` which the parent forwards to the editor.
 */
import { computed } from 'vue'
import type { TreeFile, TreeFolder } from '@/stores/treeCtrl'
import { CaretRight, Document, Folder } from '@element-plus/icons-vue'
import { useProjectStore } from '@/stores/project'

interface Props {
  node: TreeFolder | TreeFile
  depth: number
}
const props = defineProps<Props>()
const emit = defineEmits<{ (e: 'select', file: TreeFile): void }>()

const project = useProjectStore()

const isFolder = computed(() => props.node.isDirectory)
const folder = computed(() => (isFolder.value ? (props.node as TreeFolder) : null))
const padding = computed(() => 4 + props.depth * 14 + 'px')

function toggle() {
  if (folder.value) folder.value.isCollapsed = !folder.value.isCollapsed
}

function pickFile(file: TreeFile) {
  project.setActiveItem({ pathname: file.pathname, isDirectory: false })
  emit('select', file)
}
</script>

<template>
  <div v-if="isFolder">
    <div class="row" :style="{ paddingLeft: padding }" @click="toggle">
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
    @click="pickFile(node as TreeFile)"
    :title="(node as TreeFile).pathname"
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
  height: 24px;
  padding-right: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #24292e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row:hover { background: #f1f3f5; }
.row.active { background: #e1ecf4; }
.caret {
  transition: transform 100ms;
  color: #6a737d;
  font-size: 10px;
}
.caret.open { transform: rotate(90deg); }
.caret-spacer { width: 10px; display: inline-block; }
.icon {
  color: #6a737d;
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
