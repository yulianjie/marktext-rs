/**
 * Listen-for-main store — equivalent to the original `listenForMain`
 * module. Subscribes to Rust-side events and turns them into bus signals or
 * direct store dispatches. Wired up once from `main.ts` after Pinia is
 * created.
 */

import { defineStore } from 'pinia'
import { listenTyped, type EventName, type EventRegistry } from '@/services/tauri-bridge'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { useLayoutStore } from './layout'
import { usePreferencesStore } from './preferences'
import { useKeybindingsStore } from './keybindings'
import { getPreference } from '@/services/tauri-invoke'
import { bus } from '@/bus'

export const useListenForMainStore = defineStore('listenForMain', () => {
  let installed = false
  let installing: Promise<boolean> | null = null
  let localUnlisteners: UnlistenFn[] = []

  async function install(): Promise<boolean> {
    if (installed) return true
    if (installing) return installing

    installing = (async () => {
      const layout = useLayoutStore()
      const prefs = usePreferencesStore()
      const keys = useKeybindingsStore()
      const added: UnlistenFn[] = []
      const on = async <K extends EventName>(
        name: K,
        handler: (payload: EventRegistry[K]) => void,
      ) => {
        const unlisten = await listenTyped(name, handler)
        added.push(unlisten)
      }

      try {
        // Sidebar / view toggle requests from native menu.
        await on('mt://view/toggle', payload => {
          const entry = payload.entry
          if (entry === 'sideBar') layout.toggleSideBar()
          else if (entry === 'tabBar') layout.toggleTabBar()
        })

        await on('mt://palette/show', () => {
          bus.emit('show-command-palette', undefined)
        })

        await on('mt://prefs/changed', ({ patch }) => {
          prefs.applyRemotePreferences(patch)
          const keybindings = patch.keybindings
          if (keybindings && typeof keybindings === 'object' && !Array.isArray(keybindings)) {
            keys.hydrate(keybindings as Record<string, unknown>)
          }
        })

        await on('mt://userdata/changed', ({ patch }) => {
          prefs.applyRemoteUserData(patch)
        })

        localUnlisteners = added
        installed = true

        // Hydrate shortcuts only after the listener is active, closing the
        // same snapshot/subscription race as the main preference bootstrap.
        try {
          // As with the preference snapshot, retry if a live keybinding event
          // lands after an older value was read but before invoke resolves.
          for (;;) {
            const revision = keys.revision
            const persisted = await getPreference<Record<string, unknown>>('keybindings')
            if (revision !== keys.revision) continue
            if (persisted) keys.hydrate(persisted)
            break
          }
        } catch (error) {
          console.warn('[listenForMain] failed to refresh keybindings', error)
        }
        return true
      } catch (error) {
        for (const unlisten of added.reverse()) {
          try { unlisten() } catch { /* best-effort cleanup */ }
        }
        installed = false
        prefs.lastError = `Unable to subscribe to application events: ${error instanceof Error ? error.message : String(error)}`
        return false
      }
    })()

    try { return await installing } finally { installing = null }
  }

  function uninstall() {
    for (const unlisten of localUnlisteners.splice(0).reverse()) {
      try { unlisten() } catch { /* best-effort cleanup */ }
    }
    installed = false
  }

  return { install, uninstall }
})
