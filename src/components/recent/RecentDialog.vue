<script setup lang="ts">
/**
 * Recent files / folders dialog. Opened from the menu or palette ("File:
 * Open Recent…"). Click to open; "Clear" wipes the list.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Document, Folder, Delete } from '@element-plus/icons-vue'
import { bus } from '@/bus'
import { useEditorStore } from '@/stores/editor'
import { useProjectStore } from '@/stores/project'
import { usePreferencesStore } from '@/stores/preferences'
import { t } from '@/i18n'

const editor = useEditorStore()
const project = useProjectStore()
const prefs = usePreferencesStore()

const visible = ref(false)

function open() { visible.value = true }
function close() { visible.value = false }

async function openFile(path: string) {
  close()
  try { await editor.openFile(path) } catch { /* notify is handled in store */ }
}

async function openFolder(path: string) {
  close()
  await project.openRoot(path)
}

function clear() {
  prefs.clearRecents()
}

let unsub: (() => void) | null = null
onMounted(() => { unsub = bus.on('show-recent', open) })
onBeforeUnmount(() => { unsub?.() })

defineExpose({ open })
</script>

<template>
  <el-dialog v-model="visible" width="640px" align-center :show-close="true">
    <template #header>
      <div class="recent-header">
        <h3>{{ t('recent.title') }}</h3>
        <el-button v-if="prefs.recentFiles.length || prefs.recentFolders.length" size="small" link @click="clear">
          <el-icon><Delete /></el-icon> {{ t('recent.clear') }}
        </el-button>
      </div>
    </template>
    <div class="recent-body">
      <div class="section">
        <div class="section-header">{{ t('recent.folders') }}</div>
        <div v-if="!prefs.recentFolders.length" class="empty">{{ t('recent.noFolders') }}</div>
        <div v-for="path in prefs.recentFolders" :key="path" class="row" @click="openFolder(path)">
          <el-icon class="row-icon folder"><Folder /></el-icon>
          <div class="path-col">
            <div class="path-name">{{ path.split(/[\\/]/).pop() }}</div>
            <div class="path-full">{{ path }}</div>
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-header">{{ t('recent.files') }}</div>
        <div v-if="!prefs.recentFiles.length" class="empty">{{ t('recent.noFiles') }}</div>
        <div v-for="path in prefs.recentFiles" :key="path" class="row" @click="openFile(path)">
          <el-icon class="row-icon"><Document /></el-icon>
          <div class="path-col">
            <div class="path-name">{{ path.split(/[\\/]/).pop() }}</div>
            <div class="path-full">{{ path }}</div>
          </div>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.recent-header { display: flex; align-items: center; justify-content: space-between; }
.recent-header h3 { margin: 0; font-weight: 600; font-size: 15px; color: #24292e; }
.recent-body { max-height: 480px; overflow-y: auto; }
.section { margin-bottom: 16px; }
.section-header {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: #6a737d;
  letter-spacing: 0.04em;
  padding: 4px 8px;
  background: #f5f6f7;
  margin-bottom: 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  cursor: pointer;
  border-radius: 4px;
}
.row:hover { background: #f1f8ff; }
.row-icon { color: #6a737d; font-size: 16px; flex-shrink: 0; }
.row-icon.folder { color: #f6c344; }
.path-col { flex: 1; overflow: hidden; }
.path-name {
  font-size: 13px;
  font-weight: 500;
  color: #24292e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.path-full {
  font-size: 11px;
  color: #6a737d;
  font-family: ui-monospace, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.empty {
  padding: 12px;
  color: #959da5;
  font-size: 12px;
  text-align: center;
}
</style>
