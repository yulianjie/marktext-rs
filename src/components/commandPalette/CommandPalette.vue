<script setup lang="ts">
/**
 * Command palette — bus-driven modal listing every registered command.
 * Ctrl/Cmd+Shift+P or `mt://palette/show` event to open.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  nextEnabledCommandIndex,
  safeCommandIndex,
  useCommandCenterStore,
} from '@/stores/commandCenter'
import { useNotificationStore } from '@/stores/notification'
import { bus } from '@/bus'
import { t } from '@/i18n'

const cc = useCommandCenterStore()
const notify = useNotificationStore()
const visible = ref(false)
const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const rowRefs = new Map<string, HTMLElement>()

const matches = computed(() => cc.search(query.value))
const activeOptionId = computed(() => {
  const command = matches.value[selectedIndex.value]
  return command ? `command-option-${command.id.replace(/[^a-zA-Z0-9_-]/g, '-')}` : undefined
})

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
  if (!cmd || cmd.disabled) return
  try {
    if (await cc.execute(cmd.id)) close()
  } catch (error) {
    notify.pushToast({
      type: 'error',
      title: t('command.executionFailed'),
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function moveSelection(delta: -1 | 1) {
  selectedIndex.value = nextEnabledCommandIndex(matches.value, selectedIndex.value, delta)
}

function onKey(ev: KeyboardEvent) {
  if (!visible.value) return
  if (ev.key === 'Escape') { ev.preventDefault(); close() }
  else if (ev.key === 'ArrowDown') {
    ev.preventDefault()
    moveSelection(1)
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault()
    moveSelection(-1)
  } else if (ev.key === 'Enter') {
    ev.preventDefault()
    void exec(selectedIndex.value)
  }
}

function setRowRef(id: string, element: unknown) {
  if (element instanceof HTMLElement) rowRefs.set(id, element)
  else rowRefs.delete(id)
}

watch(query, () => { selectedIndex.value = 0 }, { flush: 'sync' })

watch(matches, commands => {
  selectedIndex.value = safeCommandIndex(commands, selectedIndex.value)
}, { flush: 'sync' })

watch([matches, selectedIndex], async () => {
  await nextTick()
  const command = matches.value[selectedIndex.value]
  if (command) rowRefs.get(command.id)?.scrollIntoView({ block: 'nearest' })
}, { flush: 'post' })

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
    :aria-label="t('command.title')"
  >
    <template #header>
      <input
        ref="inputRef"
        v-model="query"
        class="cp-input"
        :placeholder="t('command.placeholder')"
        spellcheck="false"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="command-palette-list"
        :aria-expanded="visible"
        :aria-activedescendant="activeOptionId"
      />
    </template>
    <div id="command-palette-list" class="cp-list" role="listbox" :aria-label="t('command.results')">
      <div
        v-for="(cmd, idx) in matches"
        :key="cmd.id"
        :id="`command-option-${cmd.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`"
        :ref="element => setRowRef(cmd.id, element)"
        class="cp-row"
        :class="{ selected: idx === selectedIndex, disabled: cmd.disabled }"
        role="option"
        :aria-selected="idx === selectedIndex"
        :aria-disabled="cmd.disabled"
        @mouseenter="selectedIndex = idx"
        @click="exec(idx)"
      >
        <span class="cp-label">
          <span v-if="cmd.category" class="cp-category">{{ cmd.category }}</span>
          <span class="cp-desc">{{ cmd.description }}</span>
        </span>
        <span v-if="cmd.shortcut?.length" class="cp-shortcut">
          {{ cmd.shortcut.join(' ') }}
        </span>
      </div>
      <div v-if="!matches.length" class="cp-empty" role="status">{{ t('command.noMatches') }}</div>
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
.cp-row.disabled {
  cursor: not-allowed;
  opacity: 0.48;
}
.cp-label {
  display: flex;
  align-items: baseline;
  min-width: 0;
}
.cp-category {
  color: #6a737d;
  margin-right: 8px;
  flex: 0 0 auto;
}
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
