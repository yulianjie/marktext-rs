/**
 * Side-effects: apply preferences store to the DOM.
 *
 * Watches reactive preferences and reflects them onto:
 *   - `document.documentElement.dataset.theme` (CSS theming hook)
 *   - `--mt-zoom`, `--mt-font-size`, `--mt-line-height`, `--mt-editor-font`,
 *     `--mt-code-font`, `--mt-code-font-size`, `--mt-editor-line-width`
 *     (CSS custom properties consumed by editor + Muya styles)
 *   - body class `mt-no-scrollbar` for the hide-scrollbar option
 *   - body class `mt-typewriter` / `mt-focus` for view modes
 *
 * Call once near the top of each window's root component after preferences
 * have been loaded. Subsequent changes are reactive — no manual re-apply
 * needed.
 *
 * The OS-color-scheme listener is installed when `autoSwitchTheme === 1`.
 * Mode 0 = always use selected theme; 2 = also use selected theme (legacy
 * default — kept for parity).
 */
import { watchEffect, onScopeDispose } from 'vue'
import { usePreferencesStore } from '@/stores/preferences'

let mediaQuery: MediaQueryList | null = null
let mediaQueryListener: ((ev: MediaQueryListEvent) => void) | null = null

function effectiveTheme(theme: string, autoSwitchMode: number): string {
  if (autoSwitchMode === 1 && typeof window !== 'undefined' && window.matchMedia) {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    return dark ? 'dark' : 'light'
  }
  return theme || 'light'
}

function setRootProp(name: string, value: string) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty(name, value)
}

function setBodyClass(name: string, on: boolean) {
  if (typeof document === 'undefined') return
  document.body.classList.toggle(name, on)
}

export function applyPreferencesToDom(): void {
  const prefs = usePreferencesStore()

  watchEffect(() => {
    const theme = effectiveTheme(prefs.theme, prefs.autoSwitchTheme)
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme
      setBodyClass('dark', theme === 'dark' || theme.includes('dark'))
    }

    // Editor display
    setRootProp('--mt-zoom', String(prefs.zoom))
    setRootProp('--mt-font-size', `${prefs.fontSize}px`)
    setRootProp('--mt-line-height', String(prefs.lineHeight))
    setRootProp('--mt-editor-font', prefs.editorFontFamily)
    setRootProp('--mt-code-font', prefs.codeFontFamily)
    setRootProp('--mt-code-font-size', `${prefs.codeFontSize}px`)
    setRootProp('--mt-editor-line-width', prefs.editorLineWidth || '860px')
    setRootProp('--mt-text-direction', prefs.textDirection)

    // Use a CSS-driven zoom: scale font instead of `zoom` to avoid layout breakage.
    setRootProp('--mt-base-font-size', `${14 * prefs.zoom}px`)

    // Body classes
    setBodyClass('mt-no-scrollbar', prefs.hideScrollbar)
    setBodyClass('mt-typewriter', prefs.typewriter)
    setBodyClass('mt-focus', prefs.focus)
    setBodyClass('mt-source-mode', prefs.sourceCode)
    setBodyClass('mt-rtl', prefs.textDirection === 'rtl')
  })

  // Live-follow OS theme when autoSwitchTheme === 1.
  watchEffect(onCleanup => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    if (prefs.autoSwitchTheme !== 1) return
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQueryListener = () => {
      const dark = mediaQuery!.matches
      const t = dark ? 'dark' : 'light'
      document.documentElement.dataset.theme = t
      setBodyClass('dark', dark)
    }
    mediaQuery.addEventListener('change', mediaQueryListener)
    onCleanup(() => {
      if (mediaQuery && mediaQueryListener) {
        mediaQuery.removeEventListener('change', mediaQueryListener)
      }
      mediaQuery = null
      mediaQueryListener = null
    })
  })

  onScopeDispose(() => {
    if (mediaQuery && mediaQueryListener) {
      mediaQuery.removeEventListener('change', mediaQueryListener)
      mediaQuery = null
      mediaQueryListener = null
    }
  })
}
