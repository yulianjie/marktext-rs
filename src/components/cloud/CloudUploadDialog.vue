<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Folder, UploadFilled } from '@element-plus/icons-vue'
import { useEditorStore } from '@/stores/editor'
import { useCloudStorageStore } from '@/stores/cloudStorage'
import { useNotificationStore } from '@/stores/notification'
import { storageListRemoteDirectories, storageUploadFile } from '@/services/tauri-invoke'
import type { RemoteDirectory } from '@/services/cloud-storage'
import { useI18n } from '@/i18n'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const editor = useEditorStore()
const cloud = useCloudStorageStore()
const notify = useNotificationStore()
const { t } = useI18n()

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const connectionId = ref('')
const remoteDirectory = ref('')
const directories = ref<RemoteDirectory[]>([])
const loadingDirectories = ref(false)
const uploading = ref(false)
const error = ref('')
const destinations = computed(() => cloud.connections.filter(connection => connection.kind !== 'git'))
const currentFileName = computed(() => editor.currentFile?.filename ?? '')

function parentDirectory(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

async function loadDirectories(): Promise<void> {
  directories.value = []
  error.value = ''
  if (!connectionId.value) return
  loadingDirectories.value = true
  try {
    directories.value = await storageListRemoteDirectories(connectionId.value, remoteDirectory.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loadingDirectories.value = false
  }
}

async function enterDirectory(directory: RemoteDirectory): Promise<void> {
  remoteDirectory.value = directory.path
  await loadDirectories()
}

async function goUp(): Promise<void> {
  remoteDirectory.value = parentDirectory(remoteDirectory.value)
  await loadDirectories()
}

async function upload(): Promise<void> {
  if (!connectionId.value || uploading.value) return
  uploading.value = true
  error.value = ''
  try {
    if (!await editor.saveCurrent()) return
    const file = editor.currentFile
    if (!file?.pathname) return
    const uploaded = await storageUploadFile(connectionId.value, file.pathname, remoteDirectory.value)
    notify.pushToast({ type: 'success', message: t('cloudUpload.complete', { path: uploaded.path }) })
    visible.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    uploading.value = false
  }
}

watch(visible, async open => {
  if (!open) return
  remoteDirectory.value = ''
  error.value = ''
  await cloud.load()
  if (!destinations.value.some(connection => connection.id === connectionId.value)) {
    connectionId.value = destinations.value[0]?.id ?? ''
  }
  await loadDirectories()
})

watch(connectionId, () => {
  if (!visible.value) return
  remoteDirectory.value = ''
  void loadDirectories()
})
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('cloudUpload.title')"
    width="min(520px, calc(100vw - 24px))"
    append-to-body
    destroy-on-close
  >
    <div class="cloud-upload-dialog">
      <p>{{ t('cloudUpload.file', { name: currentFileName }) }}</p>
      <el-form label-position="top">
        <el-form-item :label="t('cloudUpload.destination')">
          <el-select v-model="connectionId" :placeholder="t('cloudUpload.noDestination')">
            <el-option
              v-for="connection in destinations"
              :key="connection.id"
              :label="connection.name"
              :value="connection.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('cloudUpload.directory')">
          <div class="directory-path">
            <el-button :disabled="!remoteDirectory || loadingDirectories" @click="goUp">
              {{ t('cloudUpload.up') }}
            </el-button>
            <el-input :model-value="remoteDirectory ? `/${remoteDirectory}` : '/'" readonly />
          </div>
        </el-form-item>
      </el-form>
      <div class="directory-list" :aria-busy="loadingDirectories">
        <p v-if="loadingDirectories" role="status">{{ t('cloudUpload.loading') }}</p>
        <button
          v-for="directory in directories"
          v-else
          :key="directory.path"
          type="button"
          @click="enterDirectory(directory)"
        >
          <el-icon><Folder /></el-icon>
          <span>{{ directory.name }}</span>
        </button>
        <p v-if="!loadingDirectories && connectionId && !directories.length" class="empty">
          {{ t('cloudUpload.emptyDirectory') }}
        </p>
      </div>
      <el-alert v-if="error" type="error" :closable="false" show-icon>{{ error }}</el-alert>
      <el-alert
        v-if="!destinations.length"
        type="info"
        :closable="false"
        show-icon
      >
        {{ t('cloudUpload.configureFirst') }}
      </el-alert>
    </div>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.cancel') }}</el-button>
      <el-button
        type="primary"
        :icon="UploadFilled"
        :loading="uploading"
        :disabled="!connectionId || loadingDirectories"
        @click="upload"
      >
        {{ t('cloudUpload.upload') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.cloud-upload-dialog { display: grid; gap: 14px; }
.cloud-upload-dialog > p { margin: 0; color: var(--mt-fg-muted); overflow-wrap: anywhere; }
.cloud-upload-dialog :deep(.el-select) { width: 100%; }
.directory-path { display: flex; width: 100%; gap: 8px; }
.directory-list {
  min-height: 120px;
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--mt-border);
  border-radius: 7px;
  padding: 6px;
}
.directory-list button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  border: 0;
  border-radius: 5px;
  padding: 6px 8px;
  color: var(--mt-fg);
  background: transparent;
  text-align: left;
}
.directory-list button:hover,
.directory-list button:focus-visible { background: var(--mt-row-hover); }
.directory-list p { margin: 12px; color: var(--mt-fg-muted); }
</style>
