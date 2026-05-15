<script setup lang="ts">
/**
 * File-tree pane in the sidebar. Has a "Open Folder" button if no workspace
 * is open; otherwise renders the project tree.
 */
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { openFolder } from '@/services/tauri-invoke'
import { useNotificationStore } from '@/stores/notification'
import type { TreeFile } from '@/stores/treeCtrl'
import TreeRow from './TreeRow.vue'

const project = useProjectStore()
const editor = useEditorStore()
const notify = useNotificationStore()

async function pickFolder() {
  const path = await openFolder()
  if (!path) return
  await project.openRoot(path)
}

async function openFile(file: TreeFile) {
  try {
    await editor.openFile(file.pathname)
  } catch (err) {
    notify.pushToast({
      type: 'error',
      title: 'Open failed',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
</script>

<template>
  <div class="tree-pane">
    <div v-if="!project.projectTree" class="empty-state">
      <p class="empty-msg">No folder opened.</p>
      <el-button size="small" type="primary" @click="pickFolder">Open Folder…</el-button>
    </div>
    <div v-else class="tree-root">
      <div class="tree-header">
        <span class="root-name" :title="project.projectTree.pathname">{{ project.projectTree.name }}</span>
        <el-button size="small" link @click="pickFolder">change</el-button>
      </div>
      <div class="tree-list">
        <TreeRow
          v-for="child in project.projectTree.folders"
          :key="child.id"
          :node="child"
          :depth="0"
          @select="openFile"
        />
        <TreeRow
          v-for="file in project.projectTree.files"
          :key="file.id"
          :node="file"
          :depth="0"
          @select="openFile"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tree-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.empty-state {
  padding: 24px 16px;
  text-align: center;
}
.empty-msg {
  margin-bottom: 12px;
  color: #586069;
  font-size: 13px;
}
.tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #eaecef;
  font-size: 12px;
  font-weight: 600;
  color: #24292e;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.root-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.tree-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
</style>
