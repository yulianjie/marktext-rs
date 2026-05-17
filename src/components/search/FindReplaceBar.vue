<script setup lang="ts">
/**
 * Find / Replace bar — floats above the editor when `editor.findReplaceOpen`
 * is true. Drives the search through the bus (Muya picks up `find` /
 * `replace` events and highlights / replaces matches in WYSIWYG mode).
 *
 * Keyboard: Esc closes; Enter finds next; Shift+Enter finds previous.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Close, Search, ArrowDown, ArrowUp, Refresh } from '@element-plus/icons-vue'
import { useEditorStore } from '@/stores/editor'
import { bus, type SearchOpt } from '@/bus'
import { t } from '@/i18n'

const editor = useEditorStore()
const visible = computed(() => editor.findReplaceOpen)

const findInput = ref<HTMLInputElement | null>(null)
const findText = ref('')
const replaceText = ref('')
const showReplace = ref(false)
const opts = ref<SearchOpt>({ caseSensitive: false, wholeWord: false, regex: false })

const matchInfo = computed(() => {
  const sm = editor.currentFile?.searchMatches
  if (!sm || sm.matches.length === 0) return findText.value ? '0/0' : ''
  return `${sm.index + 1}/${sm.matches.length}`
})

function close() {
  editor.findReplaceOpen = false
}

function performFind() {
  bus.emit('find', { value: findText.value, opt: opts.value })
  bus.emit('searchValue', findText.value)
}

function next() {
  bus.emit('findNext', undefined)
}

function prev() {
  bus.emit('findPrev', undefined)
}

function performReplace() {
  bus.emit('replace', { value: replaceText.value, opt: opts.value })
}

function performReplaceAll() {
  bus.emit('find-action', 'replaceAll')
  bus.emit('replace', { value: replaceText.value, opt: opts.value })
}

function onKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape') { ev.preventDefault(); close() }
  else if (ev.key === 'Enter') {
    ev.preventDefault()
    if (ev.shiftKey) prev()
    else next()
  }
}

watch(visible, async (open) => {
  if (open) {
    await nextTick()
    findInput.value?.focus()
    findInput.value?.select()
    performFind()
  }
})

watch(findText, () => { if (visible.value) performFind() })

onBeforeUnmount(() => { /* nothing to clean — listeners are inline */ })
</script>

<template>
  <div v-show="visible" class="find-bar" @keydown="onKey">
    <div class="row">
      <el-icon class="row-icon"><Search /></el-icon>
      <input
        ref="findInput"
        v-model="findText"
        class="input"
        :placeholder="t('find.findPlaceholder')"
        spellcheck="false"
      />
      <span class="match-info">{{ matchInfo }}</span>
      <button class="btn" :title="t('find.previous')" @click="prev"><el-icon :size="14"><ArrowUp /></el-icon></button>
      <button class="btn" :title="t('find.next')" @click="next"><el-icon :size="14"><ArrowDown /></el-icon></button>
      <button class="btn toggle" :class="{ on: opts.caseSensitive }" :title="t('find.caseSensitive')" @click="opts.caseSensitive = !opts.caseSensitive">Aa</button>
      <button class="btn toggle" :class="{ on: opts.wholeWord }" :title="t('find.wholeWord')" @click="opts.wholeWord = !opts.wholeWord">ab</button>
      <button class="btn toggle" :class="{ on: opts.regex }" :title="t('find.regex')" @click="opts.regex = !opts.regex">.*</button>
      <button class="btn toggle" :class="{ on: showReplace }" :title="t('find.toggleReplace')" @click="showReplace = !showReplace">↳</button>
      <button class="btn close" :title="t('find.closeEsc')" @click="close"><el-icon :size="14"><Close /></el-icon></button>
    </div>
    <div v-if="showReplace" class="row">
      <el-icon class="row-icon"><Refresh /></el-icon>
      <input
        v-model="replaceText"
        class="input"
        :placeholder="t('find.replacePlaceholder')"
        spellcheck="false"
      />
      <button class="btn" :title="t('find.replace')" @click="performReplace">{{ t('find.replace') }}</button>
      <button class="btn" :title="t('find.replaceAll')" @click="performReplaceAll">{{ t('find.replaceAll') }}</button>
    </div>
  </div>
</template>

<style scoped>
.find-bar {
  position: absolute;
  top: 8px;
  right: 16px;
  z-index: 10;
  background: #fff;
  border: 1px solid #d1d5da;
  border-radius: 6px;
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.08);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  width: 440px;
}
.row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.row-icon { color: #6a737d; padding: 0 4px; }
.input {
  flex: 1;
  border: 1px solid #d1d5da;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  outline: none;
}
.input:focus { border-color: #0366d6; }
.match-info {
  color: #6a737d;
  font-size: 11px;
  font-family: ui-monospace, monospace;
  min-width: 36px;
  text-align: center;
}
.btn {
  border: 1px solid transparent;
  background: transparent;
  color: #586069;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-family: ui-monospace, monospace;
  min-width: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.btn:hover { background: #eaecef; color: #24292e; }
.btn.toggle.on {
  background: #dbedff;
  color: #0366d6;
  border-color: #79b8ff;
}
.btn.close:hover { background: #f1f3f5; }
</style>
