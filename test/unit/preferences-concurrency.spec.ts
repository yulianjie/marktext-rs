import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const invokeMocks = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  setPreference: vi.fn(),
  setPreferences: vi.fn(),
  getUserData: vi.fn(),
  setUserData: vi.fn(),
}))

vi.mock('@/services/tauri-invoke', () => invokeMocks)

import { usePreferencesStore } from '../../src/stores/preferences'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('preferences cross-window reconciliation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('does not let an older invoke completion overwrite a newer event', async () => {
    const write = deferred<void>()
    invokeMocks.setPreference.mockReturnValueOnce(write.promise)
    const store = usePreferencesStore()

    const localWrite = store.set('theme', 'dark')
    await Promise.resolve()
    store.applyRemotePreferences({ theme: 'light' })
    write.resolve()

    await expect(localWrite).resolves.toBe(true)
    expect(store.theme).toBe('light')
  })

  it('preserves a newer image-bed sibling snapshot while a patch is pending', async () => {
    const write = deferred<void>()
    invokeMocks.setUserData.mockReturnValueOnce(write.promise)
    const store = usePreferencesStore()

    const localWrite = store.patchUserData({
      imageBed: { github: { owner: 'local-owner' } },
    })
    await Promise.resolve()
    store.applyRemoteUserData({
      imageBed: {
        github: {
          owner: 'remote-owner',
          repo: 'remote-repo',
          branch: 'release',
        },
      },
    })
    write.resolve()

    await expect(localWrite).resolves.toBe(true)
    expect(store.imageBed.github).toEqual({
      owner: 'remote-owner',
      repo: 'remote-repo',
      branch: 'release',
    })
  })

  it('deep-merges queued image-bed fallback with a prior remote event', async () => {
    const blocker = deferred<void>()
    invokeMocks.setPreference.mockReturnValueOnce(blocker.promise)
    invokeMocks.setUserData.mockResolvedValueOnce(undefined)
    const store = usePreferencesStore()

    const firstWrite = store.set('theme', 'dark')
    const queuedPatch = store.patchUserData({
      imageBed: { github: { owner: 'local-owner' } },
    })
    store.applyRemoteUserData({
      imageBed: { github: { repo: 'remote-repo' } },
    })
    blocker.resolve()

    await expect(firstWrite).resolves.toBe(true)
    await expect(queuedPatch).resolves.toBe(true)
    expect(store.imageBed.github.owner).toBe('local-owner')
    expect(store.imageBed.github.repo).toBe('remote-repo')
  })
})
