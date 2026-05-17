<script setup lang="ts">
/**
 * Command palette — bus-driven modal listing every registered command.
 * Ctrl/Cmd+Shift+P or `mt://palette/show` event to open.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCommandCenterStore } from '@/stores/commandCenter'
import { bus } from '@/bus'
import { t } from '@/i18n'

const cc = useCommandCenterStore()
const visible = ref(false)
const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

const matches = computed(() => cc.search(query.value))

function open() {
  visible.value = true
  query.value = ''
  selectedIndex.value = 0
  nextTick(() => inputRef.value?.focus())
}

function close() {
  visible.value = false
}

async function exec(idx: number) {
  const cmd = matches.value[idx]
  if (!cmd) return
  close()
  await cc.execute(cmd.id)
}

function onKey(ev: KeyboardEvent) {
  if (!visible.value) return
  if (ev.key === 'Escape') { ev.preventDefault(); close() }
  else if (ev.key === 'ArrowDown') {
    ev.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, matches.value.length - 1)
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (ev.key === 'Enter') {
    ev.preventDefault()
    void exec(selectedIndex.value)
  }
}

watch(query, () => { selectedIndex.value = 0 })

let unsubBus: (() => void) | null = null

onMounted(() => {
  unsubBus = bus.on('show-command-palette', open)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  unsubBus?.()
  window.removeEventListener('keydown', onKey)
})

defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    width="560px"
    :show-close="false"
    :close-on-click-modal="true"
    class="command-palette-dialog"
    align-center
  >
    <template #header>
      <input
        ref="inputRef"
        v-model="query"
        class="cp-input"
        :placeholder="t('command.placeholder')"
        spellcheck="false"
      />
    </template>
    <div class="cp-list">
      <div
        v-for="(cmd, idx) in matches"
        :key="cmd.id"
        class="cp-row"
        :class="{ selected: idx === selectedIndex }"
        @mouseenter="selectedIndex = idx"
        @click="exec(idx)"
      >
        <span class="cp-desc">{{ cmd.description }}</span>
        <span v-if="cmd.shortcut?.length" class="cp-shortcut">
          {{ cmd.shortcut.join(' ') }}
        </span>
      </div>
      <div v-if="!matches.length" class="cp-empty">{{ t('command.noMatches') }}</div>
    </div>
  </el-dialog>
</template>

<style scoped>
.cp-input {
  width: 100%;
  padding: 8px 12px;
  font-size: 15px;
  border: 1px solid #d1d5da;
  border-radius: 6px;
  outline: none;
}
.cp-input:focus { border-color: #0366d6; }
.cp-list { max-height: 360px; overflow-y: auto; }
.cp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  border-radius: 4px;
}
.cp-row.selected { background: #f1f8ff; }
.cp-desc { color: #24292e; }
.cp-shortcut {
  color: #6a737d;
  font-size: 11px;
  font-family: ui-monospace, monospace;
}
.cp-empty {
  padding: 16px;
  text-align: center;
  color: #959da5;
  font-size: 13px;
}
</style>
