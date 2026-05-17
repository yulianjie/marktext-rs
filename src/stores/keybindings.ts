/**
 * Keybindings — user-overridable map of action id → accelerator string.
 *
 * The Rust-side native menu still owns the platform accelerators that show
 * up in the menu bar (those are baked at build time). This store owns the
 * JS-side handler that lives in `EditorPage.onKey` — when the user remaps
 * `file.save` from Ctrl+S to Ctrl+Shift+S, this is what changes.
 *
 * Persisted under the `keybindings` preference key so it survives restarts.
 */
import { defineStore } from 'pinia'
import { setPreference } from '@/services/tauri-invoke'

/** Default accelerators for the renderer-side hotkeys. Format follows the
 *  same dotted convention as menu action ids; the accelerator string uses
 *  `+`-separated tokens with the order `Ctrl/Cmd > Shift > Alt > key`. */
const defaults: Record<string, string> = {
  'file.new': 'Ctrl+T',
  'file.open': 'Ctrl+O',
  'file.openFolder': 'Ctrl+Shift+O',
  'file.save': 'Ctrl+S',
  'file.saveAs': 'Ctrl+Shift+S',
  'file.closeTab': 'Ctrl+W',
  'file.print': 'Ctrl+P',
  'edit.find': 'Ctrl+F',
  'edit.replace': 'Ctrl+H',
  'view.toggleSidebar': 'Ctrl+B',
  'view.commandPalette': 'Ctrl+Shift+P',
}

export const useKeybindingsStore = defineStore('keybindings', {
  state: () => ({ map: { ...defaults } as Record<string, string> }),

  actions: {
    hydrate(persisted: Record<string, string> | undefined | null) {
      if (!persisted) return
      // Only accept known action ids; ignore anything the user hand-edited
      // that's no longer in the defaults table.
      for (const k of Object.keys(this.map)) {
        if (typeof persisted[k] === 'string') this.map[k] = persisted[k]
      }
    },

    async set(actionId: string, accel: string) {
      if (!(actionId in this.map)) return
      this.map[actionId] = accel
      await setPreference('keybindings', this.map)
    },

    async resetAll() {
      this.map = { ...defaults }
      await setPreference('keybindings', this.map)
    },
  },

  getters: {
    /** Look up an accelerator for a given action id. */
    accel: (state) => (actionId: string): string | undefined => state.map[actionId],
    defaults: () => defaults,
    /** Reverse lookup: accelerator → action id. Used by the keydown listener. */
    byAccel: (state) => {
      const out: Record<string, string> = {}
      for (const [id, accel] of Object.entries(state.map)) {
        out[normalise(accel)] = id
      }
      return out
    },
  },
})

/** Normalise an accelerator into a canonical comparison form. */
export function normalise(accel: string): string {
  return accel
    .split('+')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toLowerCase())
    .sort((a, b) => {
      const order = ['ctrl', 'cmd', 'shift', 'alt']
      const ai = order.indexOf(a)
      const bi = order.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    .join('+')
}

/** Compute the canonical accelerator string for a KeyboardEvent. */
export function eventAccel(ev: KeyboardEvent): string {
  const parts: string[] = []
  if (ev.ctrlKey || ev.metaKey) parts.push('Ctrl')
  if (ev.shiftKey) parts.push('Shift')
  if (ev.altKey) parts.push('Alt')
  const key = ev.key
  // Map a few specials to friendlier names.
  const map: Record<string, string> = {
    ' ': 'Space',
    Escape: 'Esc',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  }
  const named = map[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) parts.push(named)
  return normalise(parts.join('+'))
}
