<script setup lang="ts">
/**
 * Muya host — mounts one Muya instance per active tab and pipes its
 * `change` events into the editor store.
 *
 * Rebuilds the instance when the active tab id changes (Muya's setMarkdown
 * preserves cursor/history within a doc, but cross-doc switches need a
 * fresh instance to wipe internal state).
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { muyaImageAction } from '@/services/muya-image-action'
import { bus } from '@/bus'

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

async function mount(initialMarkdown: string, id: string) {
  if (!editorRoot.value) return
  // Wipe any prior Muya. Construction is heavy; rebuilds only happen on tab change.
  if (muyaRef.value) {
    try { muyaRef.value.destroy?.() } catch { /* noop */ }
    muyaRef.value = null
    // Muya leaves children behind — reset the host.
    editorRoot.value.innerHTML = '<div></div>'
  }
  const Muya = await loadMuya()
  // Muya choke on empty input — its cursor has no block to attach to and the
  // first keypress crashes inside `inputCtrl`. Seed with a single newline so
  // there's always an empty paragraph block to land in.
  const seeded = initialMarkdown.length === 0 ? '\n' : initialMarkdown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let muya: any
  try {
    muya = new Muya(editorRoot.value, {
      markdown: seeded,
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
  muya.on('change', (changes: { markdown: string; wordCount?: unknown; cursor?: unknown; toc?: unknown }) => {
    editor.applyContentChange(id, changes.markdown, {
      wordCount: changes.wordCount as never,
      cursor: changes.cursor,
      toc: changes.toc as { lvl: number; content: string; slug?: string }[] | undefined,
    })
  })
  muyaRef.value = muya
  editor.setMuyaInstance(muya)
  activeBoundId.value = id
  console.info('[Muya] mounted for tab', id, 'len=', initialMarkdown.length)
}

// React to current-tab changes — mount once on first activation, then
// `setMarkdown` for in-place document swaps.
watch(
  () => editor.currentFileId,
  async (id) => {
    if (!id) return
    const tab = editor.tabs.find(t => t.id === id)
    if (!tab) return
    if (!muyaRef.value || activeBoundId.value !== id) {
      await mount(tab.markdown, id)
    } else if (muyaRef.value && muyaRef.value.getMarkdown && muyaRef.value.getMarkdown() !== tab.markdown) {
      muyaRef.value.setMarkdown(tab.markdown)
    }
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
  // Bootstrap an Untitled tab if no tabs exist yet.
  editor.bootstrap()
  const active = editor.currentFile
  if (active) await mount(active.markdown, active.id)
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
