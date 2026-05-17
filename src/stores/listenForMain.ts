/**
 * Listen-for-main store — equivalent to the original `listenForMain`
 * module. Subscribes to Rust-side events and turns them into bus signals or
 * direct store dispatches. Wired up once from `main.ts` after Pinia is
 * created.
 */

import { defineStore } from 'pinia'
import { listenTyped } from '@/services/tauri-bridge'
import { useLayoutStore } from './layout'
import { usePreferencesStore } from './preferences'
import { bus } from '@/bus'

export const useListenForMainStore = defineStore('listenForMain', () => {
  let installed = false

  async function install() {
    if (installed) return
    installed = true
    const layout = useLayoutStore()
    const prefs = usePreferencesStore()

    // Sidebar / view toggle requests from native menu
    await listenTyped('mt://view/toggle', payload => {
      const entry = payload.entry
      if (entry === 'sideBar') layout.toggleSideBar()
      else if (entry === 'tabBar') layout.toggleTabBar()
    })

    // Command palette show
    await listenTyped('mt://palette/show', () => {
      bus.emit('show-command-palette', undefined)
    })

    // Cross-window preference / user-data sync. Either was written by THIS
    // window (in which case the local store already has the value and the
    // patch is a no-op) or by a sibling Preferences window — apply the
    // patch to local state without round-tripping it back to disk.
    await listenTyped('mt://prefs/changed', ({ patch }) => {
      for (const [k, v] of Object.entries(patch)) {
        if (k in prefs.$state) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(prefs as any)[k] = v
        }
      }
    })
    await listenTyped('mt://userdata/changed', ({ patch }) => {
      for (const [k, v] of Object.entries(patch)) {
        if (k in prefs.$state) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(prefs as any)[k] = v
        }
      }
    })

    // Menu-driven file events (open from "Open Recent…", etc.) are routed
    // through `mt://window/open-file` and handled inside the editor store.
  }

  return { install }
})
