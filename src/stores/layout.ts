/**
 * Layout — sidebar/tab-bar visibility and sidebar width.
 *
 * Persists `sideBarWidth` to localStorage (cheap and synchronous, same as the
 * legacy module). Visibility flags round-trip through the preferences store
 * so they survive across windows.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { usePreferencesStore } from './preferences'

const SIDEBAR_DEFAULT = 280
const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 800
const STORAGE_KEY = 'mt:sideBarWidth'

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return SIDEBAR_DEFAULT
    const n = Number(raw)
    if (!Number.isFinite(n)) return SIDEBAR_DEFAULT
    return Math.min(Math.max(n, SIDEBAR_MIN), SIDEBAR_MAX)
  } catch {
    return SIDEBAR_DEFAULT
  }
}

export type RightColumn = '' | 'files' | 'search' | 'toc'

export const useLayoutStore = defineStore('layout', () => {
  const prefs = usePreferencesStore()

  const rightColumn = ref<RightColumn>('files')
  // Keep visibility as a direct view of the preferences store.  A local copy
  // goes stale when another window changes the same preference.
  const showSideBar = computed({
    get: () => prefs.sideBarVisibility,
    set: value => { void prefs.set('sideBarVisibility', value) },
  })
  const showTabBar = computed({
    get: () => prefs.tabBarVisibility,
    set: value => { void prefs.set('tabBarVisibility', value) },
  })
  const sideBarWidth = ref(readStoredWidth())

  /** Effective sidebar width — 0 when hidden, 45 when only the icon rail shows. */
  const effectiveSideBarWidth = computed(() => {
    if (!showSideBar.value) return 0
    if (!rightColumn.value) return 45
    return sideBarWidth.value
  })

  function setLayout(patch: Partial<{ rightColumn: RightColumn; showSideBar: boolean; showTabBar: boolean }>) {
    if (patch.rightColumn !== undefined) rightColumn.value = patch.rightColumn
    if (patch.showSideBar !== undefined) showSideBar.value = patch.showSideBar
    if (patch.showTabBar !== undefined) showTabBar.value = patch.showTabBar
  }

  function toggleSideBar() { setLayout({ showSideBar: !showSideBar.value }) }
  function toggleTabBar() { setLayout({ showTabBar: !showTabBar.value }) }

  function setSideBarWidth(width: number) {
    const clamped = Math.min(Math.max(width, SIDEBAR_MIN), SIDEBAR_MAX)
    sideBarWidth.value = clamped
    try { localStorage.setItem(STORAGE_KEY, String(clamped)) } catch { /* ignore */ }
  }

  /** Retained for existing bootstrap call sites; computed refs stay in sync. */
  function syncFromPreferences() {}

  return {
    rightColumn,
    showSideBar,
    showTabBar,
    sideBarWidth,
    effectiveSideBarWidth,
    setLayout,
    toggleSideBar,
    toggleTabBar,
    setSideBarWidth,
    syncFromPreferences,
  }
})
