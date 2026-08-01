import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  defaultKeybindings,
  normalise,
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
})
