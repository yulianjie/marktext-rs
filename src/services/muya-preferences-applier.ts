/**
 * Reactive Muya ← preferences bridge.
 *
 * The original Electron `editor.vue` has ~24 explicit watchers that forward
 * each preference change into the live Muya instance via `setOptions`,
 * `setFont`, `setTabSize`, `setListIndentation`, or `setFocusMode`. Without
 * those watchers, changing a preference (font size, list marker, HTML
 * rendering, etc.) does *nothing* until the window is reloaded — that's the
 * "markdown editing differs from upstream" symptom.
 *
 * This module installs all those watchers as a single side-effect once the
 * Muya instance is alive. Returns a teardown closure so the host component
 * unwires them cleanly in `onBeforeUnmount`.
 *
 * Mirrors editor.vue:197-451 of the upstream Electron build verbatim, with
 * one difference: theme-driven Prism CSS swapping also lives here (the
 * upstream does it via CSS classes; we hot-swap a <style> element).
 */
import { watch } from 'vue'
import { usePreferencesStore } from '@/stores/preferences'
import { spellchecker } from '@/services/spellchecker'
import { effectiveThemeId, effectiveThemeIsDark } from '@/services/preferences-applier'
import lightPrismCss from 'muya/themes/prismjs/light.theme.css?raw'
import darkPrismCss from 'muya/themes/prismjs/dark.theme.css?raw'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Muya = any

const PRISM_STYLE_ID = 'mt-prism-theme'

function applyPrismTheme(isDark: boolean) {
  let el = document.getElementById(PRISM_STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = PRISM_STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = isDark ? darkPrismCss : lightPrismCss
}

function mermaidThemeFor(isDark: boolean): string {
  return isDark ? 'dark' : 'default'
}

function vegaThemeFor(isDark: boolean): string {
  return isDark ? 'dark' : 'latimes'
}

/**
 * Install reactive preference forwarding for `muya`. Returns a teardown
 * closure that stops every installed `watch`.
 *
 * Call once, right after the Muya instance has been constructed.
 */
export function applyPreferencesToMuya(muya: Muya): () => void {
  const prefs = usePreferencesStore()

  // Apply the current Prism theme up-front so the first paint already matches
  // the configured app theme, not the import-time light default.
  applyPrismTheme(effectiveThemeIsDark.value)

  const stops: Array<() => void> = []

  // ── typography ──────────────────────────────────────────────
  stops.push(watch(() => prefs.fontSize, v => muya.setFont?.({ fontSize: v })))
  stops.push(watch(() => prefs.lineHeight, v => muya.setFont?.({ lineHeight: v })))

  // ── indentation ─────────────────────────────────────────────
  stops.push(watch(() => prefs.tabSize, v => muya.setTabSize?.(v)))
  stops.push(watch(() => prefs.listIndentation, v => muya.setListIndentation?.(v)))

  // ── focus / typewriter (typewriter scroll lives in MuyaEditor.vue's
  // selectionChange handler; here we only flip Muya's own focus mode) ──
  stops.push(watch(() => prefs.focus, v => muya.setFocusMode?.(v)))

  // ── list options ────────────────────────────────────────────
  stops.push(watch(() => prefs.preferLooseListItem, v => muya.setOptions?.({ preferLooseListItem: v })))
  stops.push(watch(() => prefs.bulletListMarker, v => muya.setOptions?.({ bulletListMarker: v })))
  stops.push(watch(() => prefs.orderListDelimiter, v => muya.setOptions?.({ orderListDelimiter: v })))

  // ── auto-pair ───────────────────────────────────────────────
  stops.push(watch(() => prefs.autoPairBracket, v => muya.setOptions?.({ autoPairBracket: v })))
  stops.push(watch(() => prefs.autoPairMarkdownSyntax, v => muya.setOptions?.({ autoPairMarkdownSyntax: v })))
  stops.push(watch(() => prefs.autoPairQuote, v => muya.setOptions?.({ autoPairQuote: v })))

  // ── Markdown extensions (need re-render → 2nd arg true) ─────
  stops.push(watch(() => prefs.frontmatterType, v => muya.setOptions?.({ frontmatterType: v })))
  stops.push(watch(() => prefs.superSubScript, v => muya.setOptions?.({ superSubScript: v }, true)))
  stops.push(watch(() => prefs.footnote, v => muya.setOptions?.({ footnote: v }, true)))
  stops.push(watch(() => prefs.isHtmlEnabled, v => muya.setOptions?.({ disableHtml: !v }, true)))
  stops.push(watch(() => prefs.isGitlabCompatibilityEnabled, v => muya.setOptions?.({ isGitlabCompatibilityEnabled: v }, true)))
  stops.push(watch(() => prefs.trimUnnecessaryCodeBlockEmptyLines, v => muya.setOptions?.({ trimUnnecessaryCodeBlockEmptyLines: v })))
  stops.push(watch(() => prefs.codeBlockLineNumbers, v => muya.setOptions?.({ codeBlockLineNumbers: v }, true)))

  // ── behaviour ───────────────────────────────────────────────
  stops.push(watch(() => prefs.hideQuickInsertHint, v => muya.setOptions?.({ hideQuickInsertHint: v })))
  stops.push(watch(() => prefs.hideLinkPopup, v => muya.setOptions?.({ hideLinkPopup: v })))
  stops.push(watch(() => prefs.autoCheck, v => muya.setOptions?.({ autoCheck: v })))

  // ── spellcheck — backed by the Rust Hunspell bridge ──────────
  // Muya's `spellcheckEnabled` flag toggles the contenteditable
  // `spellcheck` attribute (the browser's native overlay). The Rust
  // backend additionally powers our context-menu suggest / add-word UI.
  stops.push(watch(() => prefs.spellcheckerEnabled, v => {
    muya.setOptions?.({ spellcheckEnabled: v })
    void spellchecker.setEnabled(v)
  }, { immediate: true }))
  stops.push(watch(() => prefs.spellcheckerLanguage, v => {
    muya.setOptions?.({ spellcheckerLanguage: v })
    void spellchecker.setLanguage(v)
  }, { immediate: true }))

  // ── markdown serialization preference (atx vs setext for headings) ──
  // Affects the output `getMarkdown()` returns when the user types `# Heading`
  // and switches between the two styles without re-rendering. Re-render so
  // existing headings re-serialize on save.
  stops.push(watch(() => prefs.preferHeadingStyle, v => muya.setOptions?.({ preferHeadingStyle: v }, true)))

  // ── theme (Mermaid + Vega + Prism in one watcher) ───────────
  stops.push(watch([effectiveThemeId, effectiveThemeIsDark], ([, isDark]) => {
    muya.setOptions?.({
      mermaidTheme: mermaidThemeFor(isDark),
      vegaTheme: vegaThemeFor(isDark),
    }, true)
    applyPrismTheme(isDark)
  }, { immediate: true }))
  stops.push(watch(() => prefs.sequenceTheme, v => muya.setOptions?.({ sequenceTheme: v }, true)))

  return () => {
    for (const stop of stops) {
      try { stop() } catch { /* ignore */ }
    }
    stops.length = 0
  }
}
