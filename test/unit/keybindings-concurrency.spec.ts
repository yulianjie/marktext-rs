import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const setPreference = vi.hoisted(() => vi.fn())
vi.mock('@/services/tauri-invoke', () => ({ setPreference }))

import { defaultKeybindings, useKeybindingsStore } from '../../src/stores/keybindings'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('keybinding cross-window reconciliation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setPreference.mockReset()
  })

  it('keeps a newer hydrated map as the rollback baseline', async () => {
    const firstWrite = deferred<void>()
    setPreference.mockReturnValueOnce(firstWrite.promise)
    const store = useKeybindingsStore()

    const localWrite = store.set('file.save', 'Ctrl+Alt+K')
    await Promise.resolve()
    const newer = { ...defaultKeybindings, 'file.open': 'Ctrl+Alt+O' }
    store.hydrate(newer)
    firstWrite.resolve()
    await expect(localWrite).resolves.toMatchObject({ ok: true })

    setPreference.mockRejectedValueOnce(new Error('disk full'))
    await expect(store.set('file.save', 'Ctrl+Alt+K')).resolves.toMatchObject({
      ok: false,
      code: 'persist-failed',
    })
    expect(store.map).toEqual(newer)
  })
})
