<script setup lang="ts">
/**
 * About dialog. Triggered by the `aboutDialog` bus event.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { bus } from '@/bus'
import { getVersion } from '@tauri-apps/api/app'
import { t } from '@/i18n'
import { usePreferencesStore } from '@/stores/preferences'
import { getAppIconOption } from '@/services/app-icon'

const prefs = usePreferencesStore()
const currentIcon = computed(() => getAppIconOption(prefs.appIcon))

const visible = ref(false)
const appVersion = ref('0.1.0')

async function open() {
  visible.value = true
  try { appVersion.value = await getVersion() } catch { /* keep default */ }
}

let unsub: (() => void) | null = null
onMounted(() => { unsub = bus.on('aboutDialog', open) })
onBeforeUnmount(() => { unsub?.() })
</script>

<template>
  <el-dialog v-model="visible" width="420px" align-center :show-close="true">
    <template #header>
      <h3 class="about-title">{{ t('app.name') }}</h3>
    </template>
    <div class="about-body">
      <img class="about-icon" :src="currentIcon.src" :alt="currentIcon.label" />
      <p class="version">{{ t('about.version', { version: appVersion }) }}</p>
      <p class="tagline">{{ t('about.tagline') }}</p>
      <p class="meta">{{ t('about.copyright') }}</p>
    </div>
  </el-dialog>
</template>

<style scoped>
.about-title {
  margin: 0;
  font-weight: 600;
  font-size: 16px;
  color: #24292e;
}
.about-body { text-align: center; padding: 0 16px 8px; }
.about-icon {
  width: 88px;
  height: 88px;
  object-fit: contain;
  margin: 2px auto 14px;
  display: block;
}
.version {
  font-size: 14px;
  color: #586069;
  margin-bottom: 12px;
}
.tagline { color: #24292e; margin-bottom: 16px; }
.meta { color: #959da5; font-size: 12px; }
</style>
