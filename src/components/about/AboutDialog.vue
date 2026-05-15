<script setup lang="ts">
/**
 * About dialog. Triggered by the `aboutDialog` bus event.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { bus } from '@/bus'
import { getVersion } from '@tauri-apps/api/app'

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
      <h3 class="about-title">MarkText</h3>
    </template>
    <div class="about-body">
      <p class="version">Version {{ appVersion }}</p>
      <p class="tagline">Markdown editor — Tauri rewrite.</p>
      <p class="meta">© MarkText contributors · MIT License</p>
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
.version {
  font-size: 14px;
  color: #586069;
  margin-bottom: 12px;
}
.tagline { color: #24292e; margin-bottom: 16px; }
.meta { color: #959da5; font-size: 12px; }
</style>
