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
 *
 * Layered services this host wires together (Step 1–6 of the
 * "对齐 marktext 编辑效果" plan):
 *
 *   1. Constructor options come straight from `usePreferencesStore` —
 *      no hardcoded defaults; the Muya engine reads what the user has
 *      configured.
 *   2. `applyPreferencesToMuya(muya)` installs 24 reactive watchers so
 *      every later prefs change is pushed into the live instance.
 *   3. Subscribes to Muya's `selectionChange` / `selectionFormats` /
 *      `format-click` events for typewriter scroll, native-menu ✓ marks,
 *      and Ctrl/Cmd-click on links/images.
 *   4. Image-picker / autocomplete / clipboard-path callbacks are routed
 *      through `muya-image-picker.ts` (Tauri dialog + listDirectory).
 *   5. Prism light/dark CSS is hot-swapped from `muya-preferences-applier.ts`'s
 *      `theme` watcher — no static `import`.
 *   6. Extra bus handlers (`duplicate`, `insertParagraph`, `insert-image`,
 *      `invalidate-image-cache`, `switch-spellchecker-language`, …) are
 *      installed in `installBusHandlers()`.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { open as openExternal } from '@tauri-apps/plugin-shell'
import { useEditorStore } from '@/stores/editor'
import { usePreferencesStore } from '@/stores/preferences'
import { muyaImageAction } from '@/services/muya-image-action'
import { resolveLocalImageSrc } from '@/services/local-image-src'
import {
  muyaImagePathPicker,
  muyaImagePathAutoComplete,
  muyaClipboardFilePath,
} from '@/services/muya-image-picker'
import { applyPreferencesToMuya } from '@/services/muya-preferences-applier'
import { effectiveThemeId } from '@/services/preferences-applier'
import { setFormatMenuState } from '@/services/tauri-invoke'
import { spellchecker } from '@/services/spellchecker'
import { bus } from '@/bus'

const editor = useEditorStore()
const prefs = usePreferencesStore()

const editorRoot = ref<HTMLDivElement | null>(null)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const muyaRef = shallowRef<any>(null)
const activeBoundId = ref<string | null>(null)
let disposePrefsApplier: (() => void) | null = null

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
    Muya.use(ImageSelector, {
      unsplashAccessKey: '',
      photoCreatorClick: (url: string) => { void openExternal(url) },
    })
    Muya.use(Transformer)
    Muya.use(ImageToolbar)
    Muya.use(FormatPicker)
    Muya.use(FrontMenu)
    Muya.use(LinkTools, {
      jumpClick: (linkInfo: { href?: string }) => {
        const href = linkInfo?.href
        if (href) void openExternal(href)
      },
    })
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
  const isDark = /dark/i.test(effectiveThemeId.value)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let muya: any
  try {
    muya = new Muya(editorRoot.value, {
      // ── content / focus ───────────────────────────────────────
      markdown: '',
      baseUrl: '',
      imageSrcResolver: resolveLocalImageSrc,
      focusMode: prefs.focus,
      // ── typography ────────────────────────────────────────────
      fontSize: prefs.fontSize,
      lineHeight: prefs.lineHeight,
      // ── lists / indentation ───────────────────────────────────
      bulletListMarker: prefs.bulletListMarker,
      // Muya's actual option key is `orderListDelimiter` — the old code
      // passed `orderListMarker`, which Muya silently ignored.
      orderListDelimiter: prefs.orderListDelimiter,
      preferLooseListItem: prefs.preferLooseListItem,
      preferHeadingStyle: prefs.preferHeadingStyle,
      tabSize: prefs.tabSize,
      listIndentation: prefs.listIndentation,
      // ── auto-pair ─────────────────────────────────────────────
      autoPairBracket: prefs.autoPairBracket,
      autoPairMarkdownSyntax: prefs.autoPairMarkdownSyntax,
      autoPairQuote: prefs.autoPairQuote,
      // ── Markdown extensions ───────────────────────────────────
      frontmatterType: prefs.frontmatterType,
      superSubScript: prefs.superSubScript,
      footnote: prefs.footnote,
      isGitlabCompatibilityEnabled: prefs.isGitlabCompatibilityEnabled,
      // Muya reads `disableHtml`; the prefs flag is the opposite ("is HTML
      // enabled?") so invert. Previously the wrapper passed the original
      // pref key which Muya didn't recognise → HTML render permanently off.
      disableHtml: !prefs.isHtmlEnabled,
      trimUnnecessaryCodeBlockEmptyLines: prefs.trimUnnecessaryCodeBlockEmptyLines,
      codeBlockLineNumbers: prefs.codeBlockLineNumbers,
      // ── behaviour ─────────────────────────────────────────────
      hideQuickInsertHint: prefs.hideQuickInsertHint,
      hideLinkPopup: prefs.hideLinkPopup,
      autoCheck: prefs.autoCheck,
      spellcheckEnabled: prefs.spellcheckerEnabled,
      // ── diagram themes ────────────────────────────────────────
      sequenceTheme: prefs.sequenceTheme,
      mermaidTheme: isDark ? 'dark' : 'default',
      vegaTheme: isDark ? 'dark' : 'latimes',
      // ── host callbacks ────────────────────────────────────────
      imageAction: muyaImageAction,
      imagePathPicker: muyaImagePathPicker,
      imagePathAutoComplete: muyaImagePathAutoComplete,
      clipboardFilePath: muyaClipboardFilePath,
      clipboardWriteText: writeText,
    })
  } catch (err) {
    console.error('[Muya constructor failed]', err)
    return
  }

  // ── content change ──────────────────────────────────────────
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

  // ── selectionChange: typewriter scroll + cursor-stay-in-view ───
  muya.on('selectionChange', (changes: { cursorCoords?: { y: number } }) => {
    const container = editorRoot.value?.parentElement
    const y = changes?.cursorCoords?.y
    if (!container || typeof y !== 'number') return
    if (prefs.typewriter) {
      const target = container.scrollTop + y - container.clientHeight / 2
      if (Math.abs(container.scrollTop - target) > 2) {
        animatedScrollTo(container, target, 100)
      }
    }
    // Mirror upstream fix #628: keep cursor visible when it sinks below the
    // last 100px of the viewport.
    if (container.clientHeight - y < 100) {
      const editableHeight = container.clientHeight - 100
      animatedScrollTo(container, container.scrollTop + (y - editableHeight), 0)
    }
  })

  // ── selectionFormats: drive native-menu ✓ marks + future toolbar ──
  // Muya hands us an array of `{ type, … }` tokens. We strip down to the
  // type names so both the renderer toolbar and the Rust menu see a flat
  // list of strings.
  muya.on('selectionFormats', (formats: Array<{ type: string }>) => {
    const types = Array.isArray(formats) ? formats.map(f => f?.type).filter(Boolean) : []
    editor.setSelectionFormats(types)
    void setFormatMenuState(types).catch(() => {
      // Settings window doesn't have a menu — invocations from there will
      // fail; not a real error.
    })
  })

  // ── format-click: Ctrl/Cmd+click on link / image ──────────────
  muya.on('format-click', ({ event, formatType, data }: {
    event: MouseEvent
    formatType: string
    data: string | { text: string; href: string }
  }) => {
    const isOsx = navigator.platform.toLowerCase().includes('mac')
    const ctrlOrMeta = (isOsx && event.metaKey) || (!isOsx && event.ctrlKey)
    if (!ctrlOrMeta) return
    if (formatType === 'link' && typeof data === 'object' && data.href) {
      void openExternal(data.href)
    } else if (formatType === 'image' && typeof data === 'string' && data) {
      bus.emit('image-preview/open', { src: data })
    }
  })

  muyaRef.value = muya
  editor.setMuyaInstance(muya)
  disposePrefsApplier = applyPreferencesToMuya(muya)
  console.info('[Muya] constructed')
}

/** Lightweight ease-out scroll-to-y. Used for typewriter mode. */
function animatedScrollTo(el: HTMLElement, to: number, durationMs: number) {
  if (durationMs <= 0) { el.scrollTop = to; return }
  const start = el.scrollTop
  const delta = to - start
  const startTime = performance.now()
  function step(now: number) {
    const t = Math.min(1, (now - startTime) / durationMs)
    // easeOutCubic
    const eased = 1 - Math.pow(1 - t, 3)
    el.scrollTop = start + delta * eased
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/** Swap the displayed document. Mirrors the original setMarkdownToEditor. */
function loadFile(tab: { id: string; pathname: string; markdown: string; cursor?: unknown }) {
  const muya = muyaRef.value
  if (!muya) return
  // Suspend `change` writes until the new tab is bound — otherwise the
  // setMarkdown round-trip's dispatchChange fires under the *old* tab id.
  activeBoundId.value = null
  muya.setOptions({ baseUrl: tab.pathname })
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

// Save As gives an untitled document its first base directory without changing
// the tab id. Re-render in place so relative images start resolving immediately
// while preserving the editor history and Markdown source.
watch(
  () => editor.currentFile?.pathname ?? '',
  (pathname) => {
    const muya = muyaRef.value
    if (!muya || activeBoundId.value !== editor.currentFileId) return
    if (muya.options.baseUrl === pathname) return
    muya.contentState?.stateRender?.loadImageMap?.clear?.()
    muya.setOptions({ baseUrl: pathname }, true)
  },
)

/* ── bus subscriptions: forward editor actions into the live Muya instance.
 * Each handler short-circuits if no instance is mounted yet. */
const busUnsubs: Array<() => void> = []

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withMuya(fn: (muya: any) => void) {
  const m = muyaRef.value
  if (!m) return
  try { fn(m) } catch (err) { console.warn('[Muya action failed]', err) }
}

function installBusHandlers() {
  // ── paragraph / format / clipboard ────────────────────────────
  busUnsubs.push(bus.on('paragraph', (type) => withMuya(m => m.updateParagraph(type))))
  busUnsubs.push(bus.on('format', (type) => withMuya(m => m.format(type))))
  busUnsubs.push(bus.on('undo', () => withMuya(m => m.undo())))
  busUnsubs.push(bus.on('redo', () => withMuya(m => m.redo())))
  busUnsubs.push(bus.on('selectAll', () => withMuya(m => m.selectAll())))
  busUnsubs.push(bus.on('copyAsMarkdown', () => withMuya(m => m.copyAsMarkdown?.())))
  busUnsubs.push(bus.on('copyAsHtml', () => withMuya(m => m.copyAsHtml?.())))
  busUnsubs.push(bus.on('pasteAsPlainText', () => withMuya(m => m.pasteAsPlainText?.())))

  // ── paragraph manipulation (mirrors upstream bus channels) ────
  busUnsubs.push(bus.on('duplicate', () => withMuya(m => m.duplicate?.())))
  busUnsubs.push(bus.on('createParagraph', () => withMuya(m => m.insertParagraph?.('after'))))
  busUnsubs.push(bus.on('deleteParagraph', () => withMuya(m => m.deleteParagraph?.())))
  busUnsubs.push(bus.on('insertParagraph', ({ location, text, outMost }) =>
    withMuya(m => m.insertParagraph?.(location, text, outMost))))

  // ── images ─────────────────────────────────────────────────────
  busUnsubs.push(bus.on('insert-image', (imageInfo) => withMuya(m => m.insertImage?.(imageInfo))))
  busUnsubs.push(bus.on('invalidate-image-cache', () => withMuya(m => m.invalidateImageCache?.())))

  // ── tables (dialog-driven) ────────────────────────────────────
  busUnsubs.push(bus.on('insert-table', ({ rows, columns }) =>
    withMuya(m => m.createTable?.({ rows, columns }))))

  // ── spellchecker (Muya owns the contenteditable attribute) ────
  busUnsubs.push(bus.on('switch-spellchecker-language', (lang) => {
    void spellchecker.setLanguage(lang)
    withMuya(m => m.setOptions?.({ spellcheckEnabled: spellchecker.enabled }))
  }))
  busUnsubs.push(bus.on('replace-misspelling', ({ word, replacement }) => {
    spellchecker.replaceMisspelling(word, replacement)
  }))

  // ── find / replace ────────────────────────────────────────────
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

  // ── TOC click navigation ──────────────────────────────────────
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
  try { disposePrefsApplier?.() } catch { /* ignore */ }
  disposePrefsApplier = null
  editor.clearMuyaInstance()
  // Clear any leftover ✓ marks before the window/menu may be GC'd.
  void setFormatMenuState([]).catch(() => { /* ignore */ })
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
