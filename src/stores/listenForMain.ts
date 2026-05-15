/**
 * Listen-for-main store — equivalent to the original `listenForMain`
 * module. Subscribes to Rust-side events and turns them into bus signals or
 * direct store dispatches. Wired up once from `main.ts` after Pinia is
 * created.
 */

import { defineStore } from 'pinia'
import { listenTyped } from '@/services/tauri-bridge'
import { useLayoutStore } from './layout'
import { bus } from '@/bus'

export const useListenForMainStore = defineStore('listenForMain', () => {
  let installed = false

  async function install() {
    if (installed) return
    installed = true
    const layout = useLayoutStore()

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

    // Menu-driven file events (open from "Open Recent…", etc.) are routed
    // through `mt://window/open-file` and handled inside the editor store.
  }

  return { install }
})
