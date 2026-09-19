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

  it('will not let a malformed map claim Agent, title-bar, or fixed native actions', () => {
    const execute = vi.fn()
    const agent = keyEvent('a', { shiftKey: true })
    handleApplicationShortcut(agent, { 'ctrl+shift+a': 'view.toggleAgent' }, execute)
    const titlebar = keyEvent('f', { ctrlKey: false, altKey: true })
    handleApplicationShortcut(titlebar, { 'alt+f': 'titlebar.fileMenu' }, execute)
    const native = keyEvent('n', { shiftKey: true })
    handleApplicationShortcut(native, { 'ctrl+shift+n': 'file.newWindow' }, execute)

    expect(execute).not.toHaveBeenCalled()
    expect(agent.preventDefault).not.toHaveBeenCalled()
    expect(titlebar.preventDefault).not.toHaveBeenCalled()
    expect(native.preventDefault).not.toHaveBeenCalled()
  })

  it('never dispatches a lone modifier through an empty malformed binding', () => {
    const event = keyEvent('Control', { code: 'ControlLeft' })
    const execute = vi.fn()
    handleApplicationShortcut(event, { '': 'file.save' }, execute)

    expect(execute).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('uses Meta rather than physical Ctrl on macOS and never claims AltGr', () => {
    const execute = vi.fn()
    const physicalCtrl = keyEvent('s')
    handleApplicationShortcut(physicalCtrl, bindings, execute, 'macos')
    expect(execute).not.toHaveBeenCalled()

    const command = keyEvent('s', { ctrlKey: false, metaKey: true })
    handleApplicationShortcut(command, bindings, execute, 'macos')
    expect(execute).toHaveBeenCalledWith('file.save')

    const altGraph = keyEvent('s', {
      altKey: true,
      getModifierState: (modifier: string) => modifier === 'AltGraph',
    })
    handleApplicationShortcut(altGraph, bindings, execute, 'windows')
    expect(execute).toHaveBeenCalledOnce()
    expect(altGraph.preventDefault).not.toHaveBeenCalled()
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
