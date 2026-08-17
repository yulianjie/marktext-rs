<script setup lang="ts">
/**
 * File-tree pane in the sidebar. Two sections: Opened Files (always shown)
 * and Project (file tree or empty state).
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { collectTreeFilterMatches, useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { openFolder } from '@/services/tauri-invoke'
import { useNotificationStore } from '@/stores/notification'
import type { TreeFile } from '@/stores/treeCtrl'
import {
  CaretRight,
  Close,
  CopyDocument,
  DocumentAdd,
  Fold,
  FolderAdd,
  Refresh,
} from '@element-plus/icons-vue'
import { t } from '@/i18n'
import TreeRow from './TreeRow.vue'
import OpenedFileRow from './OpenedFileRow.vue'

const project = useProjectStore()
const editor = useEditorStore()
const notify = useNotificationStore()

const openedCollapsed = ref(false)
const projectCollapsed = ref(false)
const filterText = ref('')
const refreshing = ref(false)

const filterMatches = computed(() => {
  const root = project.projectTree
  return root && filterText.value.trim()
    ? collectTreeFilterMatches(root, filterText.value)
    : new Set<string>()
})

const hasFilteredNodes = computed(() => {
  return filterMatches.value.size > 0
})

watch(filterText, query => { void project.loadTreeForFilter(query) })
onBeforeUnmount(() => project.cancelFilterLoad())

async function pickFolder() {
  const path = await openFolder()
  if (!path) return
  filterText.value = ''
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

function notifyOperationError(err: unknown) {
  notify.pushToast({
    type: 'error',
    title: t('tree.operationFailed'),
    message: err instanceof Error ? err.message : String(err),
  })
}

function validateName(value: string): boolean | string {
  const name = value.trim()
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
    return t('tree.invalidName')
  }
  return true
}

async function createAtRoot(kind: 'file' | 'directory') {
  const root = project.projectTree
  if (!root) return
  project.startCreate(root.pathname, kind)
  try {
    const { value } = await ElMessageBox.prompt(
      kind === 'file' ? t('tree.newFilePrompt') : t('tree.newFolderPrompt'),
      kind === 'file' ? t('tree.newFile') : t('tree.newFolder'),
      {
        inputValue: kind === 'file' ? 'untitled.md' : '',
        inputValidator: validateName,
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        closeOnClickModal: false,
      },
    )
    const name = value.trim()
    const created = await project.createEntry(root.pathname, name, kind)
    if (kind === 'file') await editor.openFile(created)
  } catch (err) {
    // MessageBox rejects with cancel/close; those are expected, not errors.
    if (err !== 'cancel' && err !== 'close') notifyOperationError(err)
  } finally {
    project.cancelCreate()
  }
}

async function pasteAtRoot() {
  const root = project.projectTree
  if (!root || !project.clipboard) return
  try {
    await project.pasteInto(root.pathname)
  } catch (err) {
    notifyOperationError(err)
  }
}

async function refreshProject() {
  refreshing.value = true
  try {
    await project.refreshTree()
  } catch (err) {
    notifyOperationError(err)
  } finally {
    refreshing.value = false
  }
}

async function closeProject() {
  filterText.value = ''
  await project.closeRoot()
}
</script>

<template>
  <div class="tree-pane">
    <section class="section" aria-labelledby="opened-files-heading">
      <header class="section-header">
        <button
          id="opened-files-heading"
          type="button"
          class="section-toggle"
          :aria-expanded="!openedCollapsed"
          aria-controls="opened-files-content"
          @click="openedCollapsed = !openedCollapsed"
        >
          <el-icon class="caret" :class="{ open: !openedCollapsed }"><CaretRight /></el-icon>
          <span class="label">{{ t('sideBar.openedFiles') }}</span>
        </button>
      </header>
      <div
        v-show="!openedCollapsed"
        id="opened-files-content"
        class="section-body"
        :role="editor.tabs.length ? 'list' : undefined"
        :aria-label="editor.tabs.length ? t('sideBar.openedFiles') : undefined"
      >
        <div v-if="editor.tabs.length === 0" class="empty-line">{{ t('sideBar.noOpenedFiles') }}</div>
        <OpenedFileRow
          v-for="tab in editor.tabs"
          :key="tab.id"
          :tab="tab"
          :active="tab.id === editor.currentFileId"
        />
      </div>
    </section>

    <section
      class="section project-section"
      :class="{ 'has-project': project.projectTree }"
      aria-labelledby="project-heading"
    >
      <header class="section-header">
        <button
          id="project-heading"
          type="button"
          class="section-toggle"
          :aria-expanded="!projectCollapsed"
          aria-controls="project-content"
          @click="projectCollapsed = !projectCollapsed"
        >
          <el-icon class="caret" :class="{ open: !projectCollapsed }"><CaretRight /></el-icon>
          <span class="label">{{ project.projectTree ? project.projectTree.name : t('sideBar.project') }}</span>
        </button>
        <el-button v-if="project.projectTree" size="small" link class="change-btn" @click.stop="pickFolder">
          {{ t('sideBar.change') }}
        </el-button>
      </header>
      <div v-show="!projectCollapsed" id="project-content" class="section-body project-body">
        <div v-if="!project.projectTree" class="empty-state">
          <p class="empty-msg">{{ t('sideBar.noFolderOpen') }}</p>
          <el-button size="small" type="primary" @click="pickFolder">{{ t('sideBar.openFolder') }}</el-button>
        </div>
        <template v-else>
          <div class="project-controls">
            <el-input
              v-model="filterText"
              size="small"
              clearable
              :placeholder="t('tree.filterPlaceholder')"
              :aria-label="t('tree.filterPlaceholder')"
            />
            <div class="project-actions">
              <button type="button" :title="t('tree.newFile')" @click="createAtRoot('file')">
                <el-icon><DocumentAdd /></el-icon>
              </button>
              <button type="button" :title="t('tree.newFolder')" @click="createAtRoot('directory')">
                <el-icon><FolderAdd /></el-icon>
              </button>
              <button
                type="button"
                :title="t('tree.paste')"
                :disabled="!project.clipboard"
                @click="pasteAtRoot"
              >
                <el-icon><CopyDocument /></el-icon>
              </button>
              <button type="button" :title="t('common.refresh')" :disabled="refreshing" @click="refreshProject">
                <el-icon :class="{ spinning: refreshing }"><Refresh /></el-icon>
              </button>
              <button type="button" :title="t('tree.collapseAll')" @click="project.collapseAll()">
                <el-icon><Fold /></el-icon>
              </button>
              <button type="button" :title="t('tree.closeWorkspace')" @click="closeProject">
                <el-icon><Close /></el-icon>
              </button>
            </div>
          </div>
          <div v-if="filterText && project.filterLoading" class="filter-status" role="status">
            <el-icon class="spinning"><Refresh /></el-icon>
            <span>{{ t('sideBar.searching') }}</span>
          </div>
          <div
            v-else-if="filterText && project.filterError"
            class="filter-status error"
            role="alert"
            :title="project.filterError"
          >
            <span>{{ t('tree.refreshFailed') }}</span>
            <button type="button" :aria-label="t('common.refresh')" @click="project.loadTreeForFilter(filterText)">
              <el-icon><Refresh /></el-icon>
            </button>
          </div>
          <TreeRow
            v-for="child in project.projectTree.folders"
            :key="child.id"
            :node="child"
            :depth="0"
            :filter="filterText"
            :matching-paths="filterMatches"
            @select="openFile"
          />
          <TreeRow
            v-for="file in project.projectTree.files"
            :key="file.id"
            :node="file"
            :depth="0"
            :filter="filterText"
            :matching-paths="filterMatches"
            @select="openFile"
          />
          <div
            v-if="filterText && !project.filterLoading && !project.filterError && !hasFilteredNodes"
            class="empty-line"
          >
            {{ t('tree.noFilteredFiles') }}
          </div>
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
  min-height: 0;
  border-bottom: none;
}
.section.project-section.has-project { flex: 1; }
.section-header {
  display: flex;
  align-items: center;
  min-height: 30px;
  padding: 0 8px;
  user-select: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--mt-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.section-header:hover { background: var(--mt-row-hover); }
.section-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  min-height: 28px;
  flex: 1;
  padding: 0 4px;
  border: 0;
  border-radius: 4px;
  color: inherit;
  font: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  text-align: left;
  text-transform: inherit;
  background: transparent;
  cursor: pointer;
}
.section-toggle:focus-visible,
.project-actions button:focus-visible,
.filter-status button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--mt-accent) 72%, transparent);
  outline-offset: -2px;
}
.section-toggle .label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.section-toggle .caret {
  transition: transform 100ms;
  font-size: 10px;
}
.section-toggle .caret.open { transform: rotate(90deg); }
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
.project-controls {
  position: sticky;
  top: -4px;
  z-index: 2;
  padding: 4px 8px 6px;
  background: var(--mt-bg);
  border-bottom: 1px solid var(--mt-border);
}
.project-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  margin-top: 4px;
}
.project-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 23px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: var(--mt-fg-muted);
  background: transparent;
  cursor: pointer;
}
.project-actions button:hover:not(:disabled) {
  color: var(--mt-fg);
  background: var(--mt-row-hover);
}
.project-actions button:disabled {
  opacity: 0.35;
  cursor: default;
}
.spinning { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.filter-status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 3px 12px;
  color: var(--mt-fg-muted);
  font-size: 12px;
}
.filter-status.error { color: var(--el-color-danger); }
.filter-status button {
  display: inline-flex;
  padding: 2px;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.empty-line {
  padding: 6px 12px;
  color: var(--mt-fg-muted);
  font-size: 12px;
  font-style: italic;
}
.empty-state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  text-align: left;
}
.empty-msg {
  min-width: 0;
  flex: 1;
  margin: 0;
  color: var(--mt-fg-muted);
  font-size: 12px;
}
</style>
