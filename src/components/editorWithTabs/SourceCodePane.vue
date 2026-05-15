<script setup lang="ts">
/**
 * Raw-markdown source-code pane.
 *
 * A monospace textarea bound to the current tab's markdown. Edits flow back
 * into the editor store via `setMarkdownExternal`. Keeps things simple
 * (no syntax highlighting); a CodeMirror 6 upgrade can replace this later.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'

const editor = useEditorStore()
const taRef = ref<HTMLTextAreaElement | null>(null)
const local = ref('')

const currentId = computed(() => editor.currentFileId)

watch(currentId, (id) => {
  if (!id) { local.value = ''; return }
  const tab = editor.tabs.find(t => t.id === id)
  local.value = tab?.markdown ?? ''
  void nextTick(() => taRef.value?.focus())
}, { immediate: true })

// External update (e.g. file reload) — sync into local.
watch(
  () => editor.currentFile?.markdown,
  (md) => {
    if (md !== undefined && md !== local.value) local.value = md
  },
)

function onInput() {
  if (!currentId.value) return
  editor.setMarkdownExternal(currentId.value, local.value)
}
</script>

<template>
  <div class="source-pane">
    <textarea
      ref="taRef"
      v-model="local"
      class="source-textarea"
      spellcheck="false"
      placeholder="(empty document)"
      @input="onInput"
    />
  </div>
</template>

<style scoped>
.source-pane {
  flex: 1;
  display: flex;
  background: #fafbfc;
  padding: 16px;
  overflow: hidden;
}
.source-textarea {
  flex: 1;
  background: #fff;
  border: 1px solid #eaecef;
  border-radius: 4px;
  padding: 12px 16px;
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: none;
  outline: none;
  color: #24292e;
  white-space: pre;
  overflow: auto;
}
.source-textarea:focus { border-color: #0366d6; }
</style>
