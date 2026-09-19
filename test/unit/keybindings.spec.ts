import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  defaultKeybindings,
  normalise,
  normaliseKeybindingMap,
  useKeybindingsStore,
  validateKeybinding,
} from '../../src/stores/keybindings'

describe('keybinding validation', () => {
  it('normalises modifier order and display casing', () => {
    const result = validateKeybinding(
      { ...defaultKeybindings, 'file.save': 'Ctrl+S' },
      'file.save',
      'alt+ctrl+k',
    )

    expect(result).toEqual({ ok: true, normalized: 'Ctrl+Alt+K' })
    expect(normalise('Alt+Ctrl+K')).toBe('ctrl+alt+k')
  })

  it('rejects shortcuts that would hijack normal typing', () => {
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'K')).toMatchObject({
      ok: false,
      code: 'modifier-required',
    })
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'Shift+K')).toMatchObject({
      ok: false,
      code: 'modifier-required',
    })
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'F1')).toMatchObject({
      ok: false,
      code: 'modifier-required',
    })
  })

  it('rejects unsupported and fixed application shortcuts', () => {
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'Ctrl+Dead')).toMatchObject({
      ok: false,
      code: 'invalid',
    })
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'Ctrl+B')).toMatchObject({
      ok: false,
      code: 'reserved',
    })
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'Ctrl+C')).toMatchObject({
      ok: false,
      code: 'reserved',
    })
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'Ctrl+Shift+A')).toMatchObject({
      ok: false,
      code: 'reserved',
    })
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'Alt+F')).toMatchObject({
      ok: false,
      code: 'reserved',
    })
  })

  it('accepts exactly the recorder keys that the Rust native accelerator supports', () => {
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'Ctrl+NumpadAdd')).toEqual({
      ok: true,
      normalized: 'Ctrl+NumpadAdd',
    })
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'Alt+AudioVolumeDown')).toEqual({
      ok: true,
      normalized: 'Alt+VolumeDown',
    })
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'Ctrl+F24')).toEqual({
      ok: true,
      normalized: 'Ctrl+F24',
    })

    // muda's native accelerator grammar has no stable support for these web
    // media/browser/launch keys. Reject them before persistence rather than
    // letting the renderer accept a shortcut Rust later refuses.
    for (const accelerator of ['Alt+MediaPlayPause', 'Alt+BrowserBack', 'Alt+LaunchMail']) {
      expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', accelerator)).toMatchObject({
        ok: false,
        code: 'invalid',
      })
    }
  })

  it('rejects conflicts with another action', () => {
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'Ctrl+O')).toMatchObject({
      ok: false,
      code: 'conflict',
      conflictWith: 'file.open',
    })
  })

  it('treats Ctrl/Cmd aliases as the same native accelerator', () => {
    expect(normalise('Command+Shift+P')).toBe('ctrl+shift+p')
    expect(validateKeybinding({ ...defaultKeybindings }, 'file.save', 'Cmd+O')).toMatchObject({
      ok: false,
      code: 'conflict',
      conflictWith: 'file.open',
    })
  })

  it('hydrates a complete map without losing legitimate shortcut swaps', () => {
    setActivePinia(createPinia())
    const store = useKeybindingsStore()
    store.hydrate({
      ...defaultKeybindings,
      'file.new': 'Ctrl+O',
      'file.open': 'Ctrl+T',
    })

    expect(store.map['file.new']).toBe('Ctrl+O')
    expect(store.map['file.open']).toBe('Ctrl+T')
  })

  it('normalises partial legacy conflicts into a complete, non-empty map', () => {
    const normalized = normaliseKeybindingMap({
      // This used to make both New and Open collide, then could leave one
      // action with an empty string during the fallback pass.
      'file.new': 'Ctrl+O',
    })

    expect(normalized['file.new']).toBe('Ctrl+O')
    expect(normalized['file.open']).toBe('Ctrl+T')
    expect(Object.keys(normalized).sort()).toEqual(Object.keys(defaultKeybindings).sort())
    expect(Object.values(normalized).every(Boolean)).toBe(true)
    expect(new Set(Object.values(normalized).map(normalise)).size).toBe(Object.keys(defaultKeybindings).length)
  })

  it('resolves duplicate legacy choices without creating an unassigned binding', () => {
    const normalized = normaliseKeybindingMap({
      'file.new': 'Ctrl+Alt+K',
      'file.open': 'Ctrl+Alt+K',
    })

    expect(normalized['file.new']).toBe('Ctrl+Alt+K')
    expect(normalized['file.open']).toBe('Ctrl+O')
    expect(Object.values(normalized).every(Boolean)).toBe(true)
  })

  it('does not index empty accelerators from malformed external state', () => {
    setActivePinia(createPinia())
    const store = useKeybindingsStore()
    store.map = { ...defaultKeybindings, 'file.save': '' }

    expect(store.byAccel['']).toBeUndefined()
  })
})
