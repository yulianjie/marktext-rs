/**
 * Tiny typed event bus — replaces the Vue 2 `$bus` (`new Vue()` instance) used
 * throughout marktext's renderer.
 *
 * Vue 3 dropped `$on`/`$off`/`$emit`. We keep the same call sites but route
 * everything through a single mitt-style emitter. Channel names follow the
 * legacy `area::action` convention so we don't have to rewrite every call
 * site at once.
 *
 * Use sparingly. Prefer Pinia state / actions when state belongs to a store.
 * The bus is for transient UI signals (show this dialog, focus that thing).
 */

export type Handler<T = unknown> = (payload: T) => void

/**
 * Add new channels here as components are migrated. Loose `unknown` payloads
 * are intentional — components will narrow at the call site for now.
 */
export interface BusEventMap {
  // Editor
  'file-loaded': { id: string; markdown: string; cursor?: unknown }
  'file-changed': { id: string; markdown?: string }
  'editor-blur': void
  'editor-focus': void
  'screenshot-captured': { url: string }
  'invalidate-image-cache': void

  // Search / find
  'find': { value: string; opt: SearchOpt }
  'replace': { value: string; opt: SearchOpt }
  'findNext': void
  'findPrev': void
  'find-action': string
  'searchValue': string
  'replaceValue': string
  'findInFolder': void

  // Tabs
  'TABS::close-this': string
  'TABS::close-others': string
  'TABS::close-saved': void
  'TABS::close-all': void
  'TABS::rename': string
  'TABS::copy-path': string
  'TABS::show-in-folder': string

  // Sidebar
  'SIDEBAR::show-rename-input': string
  'SIDEBAR::show-new-input': { dirname: string; type: 'file' | 'directory' }
  'SIDEBAR::new': void
  'SIDEBAR::remove': void
  'SIDEBAR::copy-cut': { type: 'copy' | 'cut' }
  'SIDEBAR::paste': void
  'SIDEBAR::rename': void
  'SIDEBAR::show-in-folder': void

  // Dialogs
  'show-command-palette': void
  'show-recent': void
  'aboutDialog': void
  'tweetDialog': void
  'rename': void

  // Format / paragraph (editor toolbar)
  'paragraph': string
  'format': string

  // Commands
  'cmd::sort-commands': void
  'cmd::register-command': unknown
  'cmd::execute': string

  // TOC scroll
  'scroll-to-header': string
}

export interface SearchOpt {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

class Bus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private map = new Map<keyof BusEventMap, Set<Handler<any>>>()

  on<K extends keyof BusEventMap>(event: K, handler: Handler<BusEventMap[K]>): () => void {
    const set = this.map.get(event) ?? new Set()
    set.add(handler as Handler<unknown>)
    this.map.set(event, set)
    return () => this.off(event, handler)
  }

  off<K extends keyof BusEventMap>(event: K, handler: Handler<BusEventMap[K]>) {
    this.map.get(event)?.delete(handler as Handler<unknown>)
  }

  emit<K extends keyof BusEventMap>(event: K, payload: BusEventMap[K]): void {
    const handlers = this.map.get(event)
    if (!handlers) return
    for (const fn of handlers) {
      try { fn(payload) } catch (err) { console.error(`[bus:${String(event)}]`, err) }
    }
  }
}

export const bus = new Bus()
