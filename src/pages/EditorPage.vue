<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef } from 'vue'
import { listenTyped } from '@/services/tauri-bridge'
import {
  readMarkdown,
  saveMarkdown,
  openFiles,
  saveAsDialog,
  type LoadedDocument,
} from '@/services/tauri-invoke'

// Muya is plain JS; type it loosely until we add a `.d.ts` for it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MuyaRef = shallowRef<any>(null)
const editorRoot = ref<HTMLDivElement | null>(null)
const currentPath = ref<string | null>(null)
const isDirty = ref(false)
const lastBaseline = ref('')

async function loadMuya() {
  // Dynamic import so Muya's CSS only loads when the editor mounts.
  // @ts-expect-error Muya is JS with no .d.ts yet.
  const { default: Muya } = await import('muya/lib')
  if (!Muya.__pluginsRegistered) {
    // @ts-expect-error see above
    const [
      TablePicker, QuickInsert, CodePicker, EmojiPicker, ImagePathPicker,
      ImageSelector, ImageToolbar, Transformer, FormatPicker, LinkTools,
      FootnoteTool, TableBarTools, FrontMenu,
    ] = await Promise.all([
      // @ts-expect-error JS module
      import('muya/lib/ui/tablePicker'),
      // @ts-expect-error JS module
      import('muya/lib/ui/quickInsert'),
      // @ts-expect-error JS module
      import('muya/lib/ui/codePicker'),
      // @ts-expect-error JS module
      import('muya/lib/ui/emojiPicker'),
      // @ts-expect-error JS module
      import('muya/lib/ui/imagePicker'),
      // @ts-expect-error JS module
      import('muya/lib/ui/imageSelector'),
      // @ts-expect-error JS module
      import('muya/lib/ui/imageToolbar'),
      // @ts-expect-error JS module
      import('muya/lib/ui/transformer'),
      // @ts-expect-error JS module
      import('muya/lib/ui/formatPicker'),
      // @ts-expect-error JS module
      import('muya/lib/ui/linkTools'),
      // @ts-expect-error JS module
      import('muya/lib/ui/footnoteTool'),
      // @ts-expect-error JS module
      import('muya/lib/ui/tableTools'),
      // @ts-expect-error JS module
      import('muya/lib/ui/frontMenu'),
    ]).then(modules => modules.map(m => m.default))
    Muya.use(TablePicker)
    Muya.use(QuickInsert)
    Muya.use(CodePicker)
    Muya.use(EmojiPicker)
    Muya.use(ImagePathPicker)
    Muya.use(ImageSelector, { unsplashAccessKey: '', photoCreatorClick: () => {} })
    Muya.use(Transformer)
    Muya.use(ImageToolbar)
    Muya.use(FormatPicker)
    Muya.use(FrontMenu)
    Muya.use(LinkTools, { jumpClick: () => {} })
    Muya.use(FootnoteTool)
    Muya.use(TableBarTools)
    Muya.__pluginsRegistered = true
  }
  return Muya
}

async function mountEditor(initialMarkdown = '') {
  if (!editorRoot.value) return
  const Muya = await loadMuya()
  let muya
  try {
    muya = new Muya(editorRoot.value, {
      markdown: initialMarkdown,
      focusMode: false,
      bulletListMarker: '-',
      orderListMarker: '.',
      preferLooseListItem: true,
      autoPairBracket: true,
      autoPairMarkdownSyntax: true,
      autoPairQuote: true,
      tabSize: 4,
      listIndentation: 1,
      frontmatterType: '-',
      isHtmlEnabled: true,
      sequenceTheme: 'hand',
      hideQuickInsertHint: false,
      hideLinkPopup: false,
      autoCheck: false,
    })
  } catch (err) {
    console.error('[Muya constructor failed]', err)
    throw err
  }
  console.info('[Muya] mounted with markdown length=', initialMarkdown.length)
  muya.on('change', (changes: { markdown: string }) => {
    // First post-load change is the parse-roundtrip baseline; subsequent ones
    // are real edits. This mirrors the `pendingBaselineUpdate` flag in the
    // legacy Vuex `editor` module.
    if (lastBaseline.value === '' || changes.markdown === lastBaseline.value) {
      lastBaseline.value = changes.markdown
      isDirty.value = false
    } else {
      isDirty.value = true
    }
  })
  MuyaRef.value = muya
}

async function openFromDialog() {
  const paths = await openFiles()
  if (!paths.length) return
  const doc: LoadedDocument = await readMarkdown(paths[0])
  currentPath.value = doc.path
  lastBaseline.value = ''
  isDirty.value = false
  MuyaRef.value?.setMarkdown(doc.markdown)
}

async function save() {
  const markdown: string = MuyaRef.value?.getMarkdown?.() ?? ''
  let path = currentPath.value
  if (!path) {
    path = await saveAsDialog('untitled.md')
    if (!path) return
    currentPath.value = path
  }
  await saveMarkdown(path, markdown)
  lastBaseline.value = markdown
  isDirty.value = false
}

let unlistenOpenFile: (() => void) | null = null

onMounted(async () => {
  await mountEditor('# Welcome to MarkText\n\nStart typing…\n')
  // File-association launches forward an open-file event.
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ path: string }>).detail
    void readMarkdown(detail.path).then(doc => {
      currentPath.value = doc.path
      lastBaseline.value = ''
      MuyaRef.value?.setMarkdown(doc.markdown)
    })
  }
  window.addEventListener('mt:open-file', handler)
  unlistenOpenFile = () => window.removeEventListener('mt:open-file', handler)

  // Keyboard shortcut: Ctrl/Cmd+S to save.
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      void save()
    }
  }
  window.addEventListener('keydown', onKey)
  unlistenOpenFile = () => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('mt:open-file', handler)
  }
})

onBeforeUnmount(() => {
  unlistenOpenFile?.()
  try { MuyaRef.value?.destroy?.() } catch (err) {
    // Muya's destroy reaches into plugin state that may not exist during HMR.
    // Swallow and log — full app shutdown is handled by the WebView host.
    console.warn('[Muya destroy] non-fatal:', err)
  }
})
</script>

<template>
  <div class="editor-page">
    <header class="toolbar">
      <el-button size="small" @click="openFromDialog">Open…</el-button>
      <el-button size="small" type="primary" @click="save">
        Save{{ isDirty ? ' *' : '' }}
      </el-button>
      <span class="path">{{ currentPath || '(untitled)' }}</span>
    </header>
    <main class="muya-host">
      <div ref="editorRoot" class="muya-container">
        <div></div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.editor-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #eaecef;
  background: #fafbfc;
}
.path {
  margin-left: auto;
  font-size: 12px;
  color: #6a737d;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.muya-host {
  flex: 1;
  overflow: auto;
  padding: 32px 64px;
  background: #fff;
}
.muya-container {
  max-width: 860px;
  margin: 0 auto;
  outline: none;
}
</style>
