<script setup lang="ts">
/**
 * Compact editor command bar. All editing commands go through the same bus
 * and Pinia actions as the native menu, so this component does not own editor
 * state or reach into Muya directly.
 *
 * Pointer presses on editing buttons deliberately keep the current editor
 * selection alive. Keyboard activation still follows normal button semantics.
 */
import { computed } from 'vue'
import {
  Aim,
  EditPen,
  Grid,
  Link,
  Picture,
  RefreshLeft,
  RefreshRight,
  Search,
} from '@element-plus/icons-vue'
import { bus } from '@/bus'
import { useEditorStore } from '@/stores/editor'
import { usePreferencesStore } from '@/stores/preferences'
import { useI18n } from '@/i18n'

const editor = useEditorStore()
const prefs = usePreferencesStore()
const { locale } = useI18n()

const toolbarCopy = {
  en: {
    toolbar: 'Editor toolbar',
    history: 'History',
    blocks: 'Paragraph styles',
    inline: 'Inline formatting',
    insert: 'Insert blocks',
    view: 'Find and view modes',
    undo: 'Undo',
    redo: 'Redo',
    paragraph: 'Paragraph',
    heading: 'Heading {level}',
    bold: 'Bold',
    italic: 'Italic',
    strike: 'Strikethrough',
    inlineCode: 'Inline code',
    link: 'Link',
    image: 'Image',
    bulletList: 'Bulleted list',
    orderedList: 'Numbered list',
    taskList: 'Task list',
    quote: 'Block quote',
    codeBlock: 'Code block',
    table: 'Table',
    find: 'Find',
    source: 'Source-code mode',
    focus: 'Focus mode',
    typewriter: 'Typewriter mode',
  },
  'zh-CN': {
    toolbar: '编辑器工具栏',
    history: '历史记录',
    blocks: '段落样式',
    inline: '行内格式',
    insert: '插入块',
    view: '查找与视图模式',
    undo: '撤销',
    redo: '重做',
    paragraph: '正文',
    heading: '{level} 级标题',
    bold: '粗体',
    italic: '斜体',
    strike: '删除线',
    inlineCode: '行内代码',
    link: '链接',
    image: '图片',
    bulletList: '无序列表',
    orderedList: '有序列表',
    taskList: '任务列表',
    quote: '引用',
    codeBlock: '代码块',
    table: '表格',
    find: '查找',
    source: '源码模式',
    focus: '专注模式',
    typewriter: '打字机模式',
  },
  ja: {
    toolbar: 'エディターツールバー',
    history: '履歴',
    blocks: '段落スタイル',
    inline: 'インライン書式',
    insert: 'ブロックを挿入',
    view: '検索と表示モード',
    undo: '元に戻す',
    redo: 'やり直す',
    paragraph: '本文',
    heading: '見出し {level}',
    bold: '太字',
    italic: '斜体',
    strike: '取り消し線',
    inlineCode: 'インラインコード',
    link: 'リンク',
    image: '画像',
    bulletList: '箇条書き',
    orderedList: '番号付きリスト',
    taskList: 'タスクリスト',
    quote: '引用',
    codeBlock: 'コードブロック',
    table: '表',
    find: '検索',
    source: 'ソースコードモード',
    focus: '集中モード',
    typewriter: 'タイプライターモード',
  },
} as const

const copy = computed(() => toolbarCopy[locale.value] ?? toolbarCopy.en)
const hasDocument = computed(() => editor.currentFile !== null)
const documentDisabled = computed(() => !hasDocument.value)
const wysiwygDisabled = computed(() => documentDisabled.value || editor.sourceCodeMode)

const paragraphActions = computed(() => [
  { type: 'paragraph', glyph: 'P', label: copy.value.paragraph },
  ...Array.from({ length: 6 }, (_, index) => {
    const level = index + 1
    return {
      type: `heading ${level}`,
      glyph: `H${level}`,
      label: copy.value.heading.replace('{level}', String(level)),
    }
  }),
])

const inlineActions = computed(() => [
  { type: 'strong', glyph: 'B', label: copy.value.bold, className: 'strong' },
  { type: 'em', glyph: 'I', label: copy.value.italic, className: 'emphasis' },
  { type: 'del', glyph: 'S', label: copy.value.strike, className: 'strike' },
  { type: 'inline_code', glyph: '</>', label: copy.value.inlineCode, className: 'code' },
])

const blockActions = computed(() => [
  { type: 'ul-bullet', glyph: '•', label: copy.value.bulletList },
  { type: 'ol-order', glyph: '1.', label: copy.value.orderedList },
  { type: 'ul-task', glyph: '☑', label: copy.value.taskList },
  { type: 'blockquote', glyph: '❞', label: copy.value.quote },
  { type: 'pre', glyph: '{ }', label: copy.value.codeBlock },
])

function emitParagraph(type: string): void {
  if (!wysiwygDisabled.value) bus.emit('paragraph', type)
}

function emitFormat(type: string): void {
  if (!wysiwygDisabled.value) bus.emit('format', type)
}

function formatActive(type: string): boolean {
  return !wysiwygDisabled.value && editor.currentSelectionFormats.includes(type)
}

function undo(): void {
  if (!documentDisabled.value) bus.emit('undo', undefined)
}

function redo(): void {
  if (!documentDisabled.value) bus.emit('redo', undefined)
}

function insertTable(): void {
  if (!wysiwygDisabled.value) bus.emit('show-table-dialog', undefined)
}

function showFind(): void {
  if (hasDocument.value) editor.findReplaceOpen = true
}

function toggleSource(): void {
  if (hasDocument.value) editor.toggleSourceCode()
}

function toggleViewMode(mode: 'focus' | 'typewriter'): void {
  prefs.toggleViewMode(mode)
}
</script>

<template>
  <nav
    class="editor-toolbar"
    role="toolbar"
    aria-orientation="horizontal"
    :aria-label="copy.toolbar"
  >
    <div class="toolbar-scroll">
      <div class="toolbar-content">
        <div class="toolbar-group" role="group" :aria-label="copy.history">
          <button
            type="button"
            class="tool-button"
            data-action="undo"
            :disabled="documentDisabled"
            :aria-label="copy.undo"
            :title="`${copy.undo} (Ctrl+Z)`"
            @mousedown.prevent
            @click="undo"
          >
            <el-icon><RefreshLeft /></el-icon>
          </button>
          <button
            type="button"
            class="tool-button"
            data-action="redo"
            :disabled="documentDisabled"
            :aria-label="copy.redo"
            :title="copy.redo"
            @mousedown.prevent
            @click="redo"
          >
            <el-icon><RefreshRight /></el-icon>
          </button>
        </div>

        <div class="toolbar-divider" aria-hidden="true" />

        <div class="toolbar-group paragraph-group" role="group" :aria-label="copy.blocks">
          <button
            v-for="action in paragraphActions"
            :key="action.type"
            type="button"
            class="tool-button text-button heading-button"
            :class="{ paragraph: action.type === 'paragraph' }"
            :data-action="`paragraph:${action.type}`"
            :disabled="wysiwygDisabled"
            :aria-label="action.label"
            :title="action.label"
            @mousedown.prevent
            @click="emitParagraph(action.type)"
          >
            {{ action.glyph }}
          </button>
        </div>

        <div class="toolbar-divider" aria-hidden="true" />

        <div class="toolbar-group" role="group" :aria-label="copy.inline">
          <button
            v-for="action in inlineActions"
            :key="action.type"
            type="button"
            class="tool-button text-button"
            :class="[action.className, { active: formatActive(action.type) }]"
            :data-action="`format:${action.type}`"
            :disabled="wysiwygDisabled"
            :aria-label="action.label"
            :aria-pressed="formatActive(action.type)"
            :title="action.label"
            @mousedown.prevent
            @click="emitFormat(action.type)"
          >
            {{ action.glyph }}
          </button>
          <button
            type="button"
            class="tool-button"
            :class="{ active: formatActive('link') }"
            data-action="format:link"
            :disabled="wysiwygDisabled"
            :aria-label="copy.link"
            :aria-pressed="formatActive('link')"
            :title="`${copy.link} (Ctrl+L)`"
            @mousedown.prevent
            @click="emitFormat('link')"
          >
            <el-icon><Link /></el-icon>
          </button>
          <button
            type="button"
            class="tool-button"
            :class="{ active: formatActive('image') }"
            data-action="format:image"
            :disabled="wysiwygDisabled"
            :aria-label="copy.image"
            :aria-pressed="formatActive('image')"
            :title="copy.image"
            @mousedown.prevent
            @click="emitFormat('image')"
          >
            <el-icon><Picture /></el-icon>
          </button>
        </div>

        <div class="toolbar-divider" aria-hidden="true" />

        <div class="toolbar-group" role="group" :aria-label="copy.insert">
          <button
            v-for="action in blockActions"
            :key="action.type"
            type="button"
            class="tool-button text-button block-button"
            :data-action="`paragraph:${action.type}`"
            :disabled="wysiwygDisabled"
            :aria-label="action.label"
            :title="action.label"
            @mousedown.prevent
            @click="emitParagraph(action.type)"
          >
            {{ action.glyph }}
          </button>
          <button
            type="button"
            class="tool-button"
            data-action="insert-table"
            :disabled="wysiwygDisabled"
            :aria-label="copy.table"
            :title="copy.table"
            @mousedown.prevent
            @click="insertTable"
          >
            <el-icon><Grid /></el-icon>
          </button>
        </div>

        <div class="toolbar-divider" aria-hidden="true" />

        <div class="toolbar-group" role="group" :aria-label="copy.view">
          <button
            type="button"
            class="tool-button"
            data-action="find"
            :disabled="!hasDocument"
            :aria-label="copy.find"
            :title="`${copy.find} (Ctrl+F)`"
            @mousedown.prevent
            @click="showFind"
          >
            <el-icon><Search /></el-icon>
          </button>
          <button
            type="button"
            class="tool-button text-button code"
            :class="{ active: editor.sourceCodeMode }"
            data-action="toggle-source"
            :disabled="!hasDocument"
            :aria-label="copy.source"
            :aria-pressed="editor.sourceCodeMode"
            :title="copy.source"
            @mousedown.prevent
            @click="toggleSource"
          >
            &lt;/&gt;
          </button>
          <button
            type="button"
            class="tool-button"
            :class="{ active: prefs.focus }"
            data-action="toggle-focus"
            :aria-label="copy.focus"
            :aria-pressed="prefs.focus"
            :title="copy.focus"
            @mousedown.prevent
            @click="toggleViewMode('focus')"
          >
            <el-icon><Aim /></el-icon>
          </button>
          <button
            type="button"
            class="tool-button"
            :class="{ active: prefs.typewriter }"
            data-action="toggle-typewriter"
            :aria-label="copy.typewriter"
            :aria-pressed="prefs.typewriter"
            :title="copy.typewriter"
            @mousedown.prevent
            @click="toggleViewMode('typewriter')"
          >
            <el-icon><EditPen /></el-icon>
          </button>
        </div>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.editor-toolbar {
  flex: 0 0 auto;
  min-width: 0;
  height: 40px;
  color: var(--mt-fg-muted, #586069);
  background: var(--mt-bg, #fff);
  background: color-mix(in srgb, var(--mt-bg, #fff) 96%, var(--mt-accent, #0366d6) 4%);
  border-bottom: 1px solid var(--mt-border, #e1e4e8);
  user-select: none;
}

.toolbar-scroll {
  width: 100%;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--mt-border, #d1d5da) transparent;
}

.toolbar-scroll::-webkit-scrollbar { height: 3px; }
.toolbar-scroll::-webkit-scrollbar-thumb {
  background: var(--mt-border, #d1d5da);
  border-radius: 999px;
}

.toolbar-content {
  display: flex;
  align-items: center;
  gap: 3px;
  width: max-content;
  min-width: 100%;
  height: 100%;
  padding: 0 8px;
  box-sizing: border-box;
}

.toolbar-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  margin: 0 3px;
  flex: 0 0 auto;
  background: var(--mt-border, #dfe2e5);
}

.tool-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 29px;
  height: 29px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
}

.tool-button:hover:not(:disabled) {
  color: var(--mt-fg, #24292e);
  background: var(--mt-row-hover, #f1f3f5);
}

.tool-button.active {
  color: var(--mt-accent, #0366d6);
  background: var(--mt-row-active, #eaf5ff);
  background: color-mix(in srgb, var(--mt-accent, #0366d6) 12%, transparent);
  border-color: var(--mt-accent, #79b8ff);
  border-color: color-mix(in srgb, var(--mt-accent, #0366d6) 30%, transparent);
}

.tool-button:focus-visible {
  outline: 2px solid var(--mt-accent, #0366d6);
  outline-offset: 1px;
}

.tool-button:disabled {
  opacity: 0.38;
  cursor: default;
}

.text-button {
  width: auto;
  min-width: 29px;
  padding: 0 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.heading-button { padding-inline: 5px; }
.heading-button.paragraph { font-family: Georgia, 'Times New Roman', serif; font-size: 15px; }
.text-button.strong { font-weight: 800; }
.text-button.emphasis { font-family: Georgia, 'Times New Roman', serif; font-style: italic; }
.text-button.strike { text-decoration: line-through; }
.text-button.code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
  letter-spacing: -0.08em;
}
.block-button { min-width: 31px; }

@media (forced-colors: active) {
  .tool-button.active { border-color: Highlight; }
  .toolbar-divider { background: CanvasText; }
}
</style>
