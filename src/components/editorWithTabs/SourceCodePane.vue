<script setup lang="ts">
/**
 * Raw-markdown source-code pane backed by CodeMirror 6.
 *
 * One `EditorView` is created on mount; switching tabs `dispatch`-replaces
 * the document instead of rebuilding the editor (cheaper, preserves DOM
 * focus). Edits flow back into the editor store via `setMarkdownExternal`.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { useEditorStore } from '@/stores/editor'

const editor = useEditorStore()
const hostRef = ref<HTMLDivElement | null>(null)
const viewRef = shallowRef<EditorView | null>(null)
/** Last id the view's content was synced with — used to detect tab swaps. */
const boundId = ref<string | null>(null)

// Minimal markdown highlighting palette. Inherits font / colours from the
// host stylesheet otherwise.
const mdHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.4em', fontWeight: '600', color: '#22863a' },
  { tag: tags.heading2, fontSize: '1.25em', fontWeight: '600', color: '#22863a' },
  { tag: tags.heading3, fontSize: '1.15em', fontWeight: '600', color: '#22863a' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '600', color: '#22863a' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: '#0366d6', textDecoration: 'underline' },
  { tag: tags.url, color: '#0366d6' },
  { tag: tags.monospace, color: '#d73a49', background: '#fafbfc' },
  { tag: tags.list, color: '#005cc5' },
  { tag: tags.quote, color: '#6a737d', fontStyle: 'italic' },
])

const baseExtensions = (): Extension[] => [
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  history(),
  indentOnInput(),
  bracketMatching(),
  markdown({ base: markdownLanguage }),
  syntaxHighlighting(mdHighlight),
  EditorView.lineWrapping,
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  EditorView.updateListener.of(update => {
    if (!update.docChanged) return
    if (!boundId.value) return
    editor.setMarkdownExternal(boundId.value, update.state.doc.toString())
  }),
]

function buildState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: baseExtensions() })
}

function mountView(initialDoc: string, id: string) {
  if (!hostRef.value) return
  viewRef.value = new EditorView({
    state: buildState(initialDoc),
    parent: hostRef.value,
  })
  boundId.value = id
}

function swapDoc(doc: string, id: string) {
  const view = viewRef.value
  if (!view) { mountView(doc, id); return }
  // Replace the entire doc but keep history; suppress our updateListener
  // re-entering by toggling boundId first.
  const prevId = boundId.value
  boundId.value = null
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } })
  boundId.value = id
  void prevId // intentionally unused
}

onMounted(() => {
  const tab = editor.currentFile
  mountView(tab?.markdown ?? '', tab?.id ?? '')
})

watch(
  () => editor.currentFileId,
  (id) => {
    if (!id) return
    const tab = editor.tabs.find(t => t.id === id)
    if (!tab) return
    if (boundId.value === id) return
    swapDoc(tab.markdown, id)
  },
)

// External update (Muya saved, file reloaded) — sync into the view.
watch(
  () => editor.currentFile?.markdown,
  (md) => {
    if (md === undefined) return
    const view = viewRef.value
    if (!view) return
    if (md === view.state.doc.toString()) return
    if (!boundId.value) return
    // Caller is overwriting our local edits — keep cursor at top to avoid OOB.
    const id = boundId.value
    boundId.value = null
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: md } })
    boundId.value = id
  },
)

onBeforeUnmount(() => {
  viewRef.value?.destroy()
  viewRef.value = null
})
</script>

<template>
  <div class="source-pane">
    <div ref="hostRef" class="cm-host" />
  </div>
</template>

<style scoped>
.source-pane {
  flex: 1;
  display: flex;
  background: #fafbfc;
  overflow: hidden;
}
.cm-host {
  flex: 1;
  overflow: auto;
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
  font-size: 13px;
  background: #fff;
}
.cm-host :deep(.cm-editor) {
  height: 100%;
}
.cm-host :deep(.cm-scroller) {
  font-family: inherit;
  line-height: 1.6;
}
.cm-host :deep(.cm-gutters) {
  background: #fafbfc;
  border-right: 1px solid #eaecef;
  color: #959da5;
}
.cm-host :deep(.cm-activeLineGutter) {
  background: #f1f8ff;
  color: #24292e;
}
.cm-host :deep(.cm-activeLine) {
  background: #f6f8fa;
}
.cm-host :deep(.cm-content) {
  padding: 16px 0;
}
</style>
