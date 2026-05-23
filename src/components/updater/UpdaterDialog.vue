<script setup lang="ts">
/**
 * Auto-update dialog — driven by `@tauri-apps/plugin-updater`. Opens on
 * `bus.emit('show-updater-dialog')` from the Help → Check for Updates menu
 * action.
 *
 * With `pubkey` empty in `tauri.conf.json` the plugin call gracefully fails
 * and we show "no update available" — the dialog is still wired up so the
 * UX is complete once signing lands.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { bus } from '@/bus'
import { useI18n } from '@/i18n'

const { t } = useI18n()

type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'uptodate' | 'error'

const visible = ref(false)
const phase = ref<Phase>('idle')
const version = ref('')
const notes = ref('')
const error = ref('')
const downloaded = ref(0)
const total = ref(0)

async function open() {
  visible.value = true
  phase.value = 'checking'
  error.value = ''
  version.value = ''
  notes.value = ''
  downloaded.value = 0
  total.value = 0

  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) {
      phase.value = 'uptodate'
      return
    }
    version.value = update.version ?? ''
    notes.value = update.body ?? ''
    phase.value = 'available'
    // Stash on window so the install action can reach it
    ;(window as unknown as { __mt_update?: unknown }).__mt_update = update
  } catch (err) {
    phase.value = 'error'
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function downloadAndInstall() {
  const update = (window as unknown as { __mt_update?: { downloadAndInstall: (cb: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void> } }).__mt_update
  if (!update) return
  phase.value = 'downloading'
  try {
    await update.downloadAndInstall((ev) => {
      if (ev.event === 'Started') total.value = ev.data?.contentLength ?? 0
      else if (ev.event === 'Progress') downloaded.value += ev.data?.chunkLength ?? 0
      else if (ev.event === 'Finished') phase.value = 'ready'
    })
  } catch (err) {
    phase.value = 'error'
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function relaunchApp() {
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

let unsub: (() => void) | null = null
onMounted(() => { unsub = bus.on('show-updater-dialog', () => { void open() }) })
onBeforeUnmount(() => { unsub?.() })
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('updater.title')"
    width="420px"
    :close-on-click-modal="false"
    append-to-body
  >
    <div v-if="phase === 'checking'">{{ t('updater.checking') }}</div>
    <div v-else-if="phase === 'uptodate'">{{ t('updater.uptodate') }}</div>
    <div v-else-if="phase === 'available'">
      <p>{{ t('updater.available', { version }) }}</p>
      <pre v-if="notes" class="notes">{{ notes }}</pre>
    </div>
    <div v-else-if="phase === 'downloading'">
      <p>{{ t('updater.downloading') }}</p>
      <el-progress
        :percentage="total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0"
      />
    </div>
    <div v-else-if="phase === 'ready'">{{ t('updater.ready') }}</div>
    <div v-else-if="phase === 'error'" class="error">{{ t('updater.error') }}: {{ error }}</div>

    <template #footer>
      <el-button v-if="phase === 'available'" type="primary" @click="downloadAndInstall">
        {{ t('updater.install') }}
      </el-button>
      <el-button v-if="phase === 'ready'" type="primary" @click="relaunchApp">
        {{ t('updater.relaunch') }}
      </el-button>
      <el-button @click="visible = false">{{ t('common.close') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.notes {
  max-height: 200px;
  overflow: auto;
  background: var(--el-fill-color-light);
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: pre-wrap;
}
.error {
  color: var(--el-color-danger);
}
</style>
