<script setup lang="ts">
/**
 * Muya host — one Muya instance for the lifetime of this component;
 * tab switches swap content via setMarkdown rather than destroying and
 * rebuilding (mirrors the original Electron marktext editor.vue).
 *
 * Having both onMounted and watch(currentFileId) call a destroy/recreate
 * `mount()` produced a microtask race where two Muya instances were
 * constructed for the initial Untitled tab, leaving the DOM half-built
 * and breaking the first inline conversion (e.g. `## hi` → H2).
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { muyaImageAction } from '@/services/muya-image-action'
import { bus } from '@/bus'
// Prism token colors — the editor renders highlighted code as <span class="token …">,
// but Muya's own stylesheet doesn't ship the prism theme. Without this import the
// token spans are emitted but render in the default text color.
import 'muya/themes/prismjs/light.theme.css'

const editor = useEditorStore()

const editorRoot = ref<HTMLDivElement | null>(null)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const muyaRef = shallowRef<any>(null)
const activeBoundId = ref<string | null>(null)

async function loadMuya() {
  const { default: Muya } = await import('muya/lib')
  if (!Muya.__pluginsRegistered) {
    const mods = await Promise.all([
      import('muya/lib/ui/tablePicker'),
      import('muya/lib/ui/quickInsert'),
      import('muya/lib/ui/codePicker'),
      import('muya/lib/ui/emojiPicker'),
      import('muya/lib/ui/imagePicker'),
      import('muya/lib/ui/imageSelector'),
      import('muya/lib/ui/imageToolbar'),
      import('muya/lib/ui/transformer'),
      import('muya/lib/ui/formatPicker'),
      import('muya/lib/ui/linkTools'),
      import('muya/lib/ui/footnoteTool'),
      import('muya/lib/ui/tableTools'),
      import('muya/lib/ui/frontMenu'),
    ])
    const [TablePicker, QuickInsert, CodePicker, EmojiPicker, ImagePathPicker,
      ImageSelector, ImageToolbar, Transformer, FormatPicker, LinkTools,
      FootnoteTool, TableBarTools, FrontMenu] = mods.map(m => m.default)
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

/** Build the single Muya instance. Idempotent: subsequent calls no-op. */
async function construct() {
  if (muyaRef.value || !editorRoot.value) return
  const Muya = await loadMuya()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let muya: any
  try {
    muya = new Muya(editorRoot.value, {
      markdown: '',
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
      // Muya calls this whenever it materialises an image (drag/paste/local
      // picker). The service routes the file/path through the preference-
      // driven path/folder/upload strategies.
      imageAction: muyaImageAction,
    })
  } catch (err) {
    console.error('[Muya constructor failed]', err)
    return
  }
  // Resolve the active tab at event-fire time, not closure time — the single
  // instance survives tab switches so the listener must always write into
  // whichever tab is currently mounted.
  muya.on('change', (changes: { markdown: string; wordCount?: unknown; cursor?: unknown; toc?: unknown }) => {
    const id = activeBoundId.value
    if (!id) return
    editor.applyContentChange(id, changes.markdown, {
      wordCount: changes.wordCount as never,
      cursor: changes.cursor,
      toc: changes.toc as { lvl: number; content: string; slug?: string }[] | undefined,
    })
  })
  muyaRef.value = muya
  editor.setMuyaInstance(muya)
  console.info('[Muya] constructed')
}

/** Swap the displayed document. Mirrors the original setMarkdownToEditor. */
function loadFile(tab: { id: string; markdown: string; cursor?: unknown }) {
  const muya = muyaRef.value
  if (!muya) return
  // Suspend `change` writes until the new tab is bound — otherwise the
  // setMarkdown round-trip's dispatchChange fires under the *old* tab id.
  activeBoundId.value = null
  muya.clearHistory()
  if (tab.cursor) {
    muya.setMarkdown(tab.markdown, tab.cursor, true)
  } else {
    muya.setMarkdown(tab.markdown)
  }
  activeBoundId.value = tab.id
}

// React to current-tab changes — content swap only, never destroy/recreate.
watch(
  () => editor.currentFileId,
  (id) => {
    if (!id) return
    const tab = editor.tabs.find(t => t.id === id)
    if (!tab) return
    if (activeBoundId.value === id) return
    loadFile(tab)
  },
  { immediate: false },
)

/* ── bus subscriptions: forward editor actions into the live Muya instance.
 * Each handler short-circuits if no instance is mounted yet. */
const busUnsubs: Array<() => void> = []

function withMuya(fn: (muya: any) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const m = muyaRef.value
  if (!m) return
  try { fn(m) } catch (err) { console.warn('[Muya action failed]', err) }
}

function installBusHandlers() {
  busUnsubs.push(bus.on('paragraph', (type) => withMuya(m => m.updateParagraph(type))))
  busUnsubs.push(bus.on('format', (type) => withMuya(m => m.format(type))))
  busUnsubs.push(bus.on('undo', () => withMuya(m => m.undo())))
  busUnsubs.push(bus.on('redo', () => withMuya(m => m.redo())))
  busUnsubs.push(bus.on('selectAll', () => withMuya(m => m.selectAll())))
  busUnsubs.push(bus.on('copyAsMarkdown', () => withMuya(m => m.copyAsMarkdown?.())))
  busUnsubs.push(bus.on('copyAsHtml', () => withMuya(m => m.copyAsHtml?.())))
  busUnsubs.push(bus.on('pasteAsPlainText', () => withMuya(m => m.pasteAsPlainText?.())))
  // Find / replace — Muya returns updated searchMatches we push into the tab.
  busUnsubs.push(bus.on('find', ({ value, opt }) => withMuya(m => {
    const matches = m.search(value, opt)
    if (matches) editor.applySearchResult(matches)
    scrollToHighlight()
  })))
  busUnsubs.push(bus.on('replace', ({ value, opt }) => withMuya(m => {
    const matches = m.replace(value, opt)
    if (matches) editor.applySearchResult(matches)
  })))
  busUnsubs.push(bus.on('findNext', () => withMuya(m => {
    const matches = m.find('next')
    if (matches) editor.applySearchResult(matches)
    scrollToHighlight()
  })))
  busUnsubs.push(bus.on('findPrev', () => withMuya(m => {
    const matches = m.find('prev')
    if (matches) editor.applySearchResult(matches)
    scrollToHighlight()
  })))
  busUnsubs.push(bus.on('find-action', (action) => withMuya(m => {
    const matches = m.find(action)
    if (matches) editor.applySearchResult(matches)
    scrollToHighlight()
  })))
  // TOC click navigation.
  busUnsubs.push(bus.on('scroll-to-header', (slug) => {
    const el = document.getElementById(slug)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }))
}

function scrollToHighlight() {
  const el = document.querySelector('.ag-highlight')
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

onMounted(async () => {
  // Construct the single Muya instance BEFORE touching the store. If we
  // bootstrapped first, the watch(currentFileId) microtask would fire while
  // construct() was awaiting Muya's dynamic imports, racing this path.
  await construct()
  editor.bootstrap()
  const active = editor.currentFile
  if (active) loadFile(active)
  installBusHandlers()
})

onBeforeUnmount(() => {
  for (const off of busUnsubs) { try { off() } catch { /* ignore */ } }
  busUnsubs.length = 0
  editor.clearMuyaInstance()
  try { muyaRef.value?.destroy?.() } catch (err) {
    console.warn('[Muya destroy] non-fatal:', err)
  }
})
</script>

<template>
  <div class="muya-host">
    <div ref="editorRoot" class="muya-container">
      <div></div>
    </div>
  </div>
</template>

<style scoped>
.muya-host {
  flex: 1;
  overflow: auto;
  background: var(--mt-bg, #fff);
  padding: 32px 0;
  font-family: var(--mt-editor-font);
  font-size: var(--mt-font-size);
  line-height: var(--mt-line-height);
  color: var(--mt-fg);
}
.muya-container {
  max-width: var(--mt-editor-line-width, 860px);
  margin: 0 auto;
  padding: 0 64px;
  outline: none;
}
.muya-host :deep(code),
.muya-host :deep(pre) {
  font-family: var(--mt-code-font);
  font-size: var(--mt-code-font-size);
}
</style>
