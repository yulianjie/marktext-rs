import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const invokeMocks = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  setPreference: vi.fn(),
  setPreferences: vi.fn(),
  pushRecentPath: vi.fn(),
  getUserData: vi.fn(),
  setUserData: vi.fn(),
}))

vi.mock('@/services/tauri-invoke', () => invokeMocks)

import {
  createDefaultPreferencesState,
  sanitizePreferences,
  usePreferencesStore,
} from '../../src/stores/preferences'
import { useLayoutStore } from '../../src/stores/layout'

describe('editor chrome visibility preferences', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    invokeMocks.setPreference.mockResolvedValue(undefined)
  })

  it('defaults both bars to visible and strictly sanitizes boolean patches', () => {
    const state = createDefaultPreferencesState()

    expect(state.toolBarVisibility).toBe(true)
    expect(state.statusBarVisibility).toBe(true)
    expect(sanitizePreferences({
      toolBarVisibility: false,
      statusBarVisibility: false,
    })).toEqual({
      toolBarVisibility: false,
      statusBarVisibility: false,
    })
    expect(sanitizePreferences({
      toolBarVisibility: 'false',
      statusBarVisibility: 0,
    })).toEqual({})
  })

  it('exposes live computed values and persists each layout toggle', async () => {
    const prefs = usePreferencesStore()
    const layout = useLayoutStore()

    expect(layout.showToolBar).toBe(true)
    expect(layout.showStatusBar).toBe(true)

    layout.toggleToolBar()
    layout.toggleStatusBar()

    expect(layout.showToolBar).toBe(false)
    expect(layout.showStatusBar).toBe(false)
    await vi.waitFor(() => {
      expect(invokeMocks.setPreference).toHaveBeenCalledWith('toolBarVisibility', false)
      expect(invokeMocks.setPreference).toHaveBeenCalledWith('statusBarVisibility', false)
    })

    prefs.applyRemotePreferences({ toolBarVisibility: true, statusBarVisibility: true })
    expect(layout.showToolBar).toBe(true)
    expect(layout.showStatusBar).toBe(true)
  })
})
