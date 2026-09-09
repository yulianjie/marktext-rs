import { describe, expect, it, vi } from 'vitest'
import { handleApplicationShortcut, rendererOwnsApplicationShortcuts } from '../../src/services/application-shortcuts'
import { defaultKeybindings, normalise } from '../../src/stores/keybindings'

const bindings = Object.fromEntries(Object.entries(defaultKeybindings).map(([id, key]) => [normalise(key), id]))
function keyEvent(key: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key, code: `Key${key.toUpperCase()}`, ctrlKey: true, metaKey: false,
    shiftKey: false, altKey: false, defaultPrevented: false, isComposing: false,
    repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra,
  } as unknown as KeyboardEvent
}

describe('application shortcut ownership and dispatch', () => {
  it('handles Windows Tauri and browser keys, retaining native ownership elsewhere', () => {
    expect(rendererOwnsApplicationShortcuts(true, 'Win32')).toBe(true)
    expect(rendererOwnsApplicationShortcuts(true, 'MacIntel')).toBe(false)
    expect(rendererOwnsApplicationShortcuts(true, 'Linux x86_64')).toBe(false)
    expect(rendererOwnsApplicationShortcuts(false, 'Linux x86_64')).toBe(true)
  })

  it.each([
    ['s', false, 'file.save'], ['s', true, 'file.saveAs'],
    ['o', false, 'file.open'], ['o', true, 'file.openFolder'],
    ['w', false, 'file.closeTab'], ['t', false, 'file.new'],
    ['p', false, 'file.print'], ['p', true, 'view.commandPalette'],
    ['f', false, 'edit.find'], ['h', false, 'edit.replace'],
    ['b', true, 'view.toggleSidebar'],
  ])('dispatches %s shift=%s exactly once', (key, shiftKey, action) => {
    const event = keyEvent(key, { shiftKey })
    const execute = vi.fn()
    handleApplicationShortcut(event, bindings, execute)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(action)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it('uses remapped bindings and leaves the old key to the focused control', () => {
    const execute = vi.fn()
    const remapped = { 'ctrl+alt+k': 'file.save' }
    const old = keyEvent('s')
    handleApplicationShortcut(old, remapped, execute)
    expect(old.preventDefault).not.toHaveBeenCalled()
    handleApplicationShortcut(keyEvent('k', { altKey: true }), remapped, execute)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith('file.save')
  })

  it('consumes repeats without opening duplicate dialogs or closing more tabs', () => {
    const event = keyEvent('w', { repeat: true })
    const execute = vi.fn()
    handleApplicationShortcut(event, bindings, execute)
    expect(execute).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it.each([{ isComposing: true }, { defaultPrevented: true }, { ctrlKey: false }])(
    'leaves composing, handled and ordinary typing events alone: %j', extra => {
      const event = keyEvent('s', extra)
      const execute = vi.fn()
      handleApplicationShortcut(event, bindings, execute)
      expect(execute).not.toHaveBeenCalled()
      expect(event.preventDefault).not.toHaveBeenCalled()
    },
  )
})
