<script setup lang="ts">
/**
 * File-tree pane in the sidebar. Two sections: Opened Files (always shown)
 * and Project (file tree or empty state).
 */
import { ref } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { openFolder } from '@/services/tauri-invoke'
import { useNotificationStore } from '@/stores/notification'
import type { TreeFile } from '@/stores/treeCtrl'
import { CaretRight } from '@element-plus/icons-vue'
import { t } from '@/i18n'
import TreeRow from './TreeRow.vue'
import OpenedFileRow from './OpenedFileRow.vue'

const project = useProjectStore()
const editor = useEditorStore()
const notify = useNotificationStore()

const openedCollapsed = ref(false)
const projectCollapsed = ref(false)

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
    <section class="section">
      <header class="section-header" @click="openedCollapsed = !openedCollapsed">
        <el-icon class="caret" :class="{ open: !openedCollapsed }"><CaretRight /></el-icon>
        <span class="label">{{ t('sideBar.openedFiles') }}</span>
      </header>
      <div v-show="!openedCollapsed" class="section-body">
        <div v-if="editor.tabs.length === 0" class="empty-line">{{ t('sideBar.noOpenedFiles') }}</div>
        <OpenedFileRow
          v-for="tab in editor.tabs"
          :key="tab.id"
          :tab="tab"
          :active="tab.id === editor.currentFileId"
        />
      </div>
    </section>

    <section class="section project-section">
      <header class="section-header" @click="projectCollapsed = !projectCollapsed">
        <el-icon class="caret" :class="{ open: !projectCollapsed }"><CaretRight /></el-icon>
        <span class="label">{{ project.projectTree ? project.projectTree.name : t('sideBar.project') }}</span>
        <el-button v-if="project.projectTree" size="small" link class="change-btn" @click.stop="pickFolder">
          {{ t('sideBar.change') }}
        </el-button>
      </header>
      <div v-show="!projectCollapsed" class="section-body project-body">
        <div v-if="!project.projectTree" class="empty-state">
          <p class="empty-msg">{{ t('sideBar.noFolderOpen') }}</p>
          <el-button size="small" type="primary" @click="pickFolder">{{ t('sideBar.openFolder') }}</el-button>
        </div>
        <template v-else>
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
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tree-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.section {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-bottom: 1px solid var(--mt-border);
}
.section.project-section {
  flex: 1;
  min-height: 0;
  border-bottom: none;
}
.section-header {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 12px;
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--mt-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.section-header:hover { background: var(--mt-row-hover); }
.section-header .label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.section-header .caret {
  transition: transform 100ms;
  font-size: 10px;
}
.section-header .caret.open { transform: rotate(90deg); }
.change-btn { margin-left: 4px; }
.section-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.project-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.empty-line {
  padding: 6px 12px;
  color: var(--mt-fg-muted);
  font-size: 12px;
  font-style: italic;
}
.empty-state {
  padding: 24px 16px;
  text-align: center;
}
.empty-msg {
  margin-bottom: 12px;
  color: var(--mt-fg-muted);
  font-size: 13px;
}
</style>
