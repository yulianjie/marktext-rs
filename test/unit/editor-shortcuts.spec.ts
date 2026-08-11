import { describe, expect, it } from 'vitest'

import { resolveFixedEditorShortcut } from '../../src/services/editor-shortcuts'

describe('fixed editor shortcut routing', () => {
  it('routes undo and both Windows redo conventions into one editor history', () => {
    expect(resolveFixedEditorShortcut('ctrl+z', false)).toBe('edit.undo')
    expect(resolveFixedEditorShortcut('ctrl+y', false)).toBe('edit.redo')
    expect(resolveFixedEditorShortcut('ctrl+shift+z', false)).toBe('edit.redo')
  })

  it('uses the macOS redo convention without claiming Cmd+Y', () => {
    expect(resolveFixedEditorShortcut('ctrl+shift+z', true)).toBe('edit.redo')
    expect(resolveFixedEditorShortcut('ctrl+y', true)).toBeNull()
  })

  it('maps selection, headings, and inline formatting without modifier bleed', () => {
    expect(resolveFixedEditorShortcut('ctrl+a', false)).toBe('edit.selectAll')
    expect(resolveFixedEditorShortcut('ctrl+3', false)).toBe('paragraph.h3')
    expect(resolveFixedEditorShortcut('ctrl+b', false)).toBe('format.bold')
    expect(resolveFixedEditorShortcut('ctrl+shift+i', false)).toBe('format.image')
    expect(resolveFixedEditorShortcut('ctrl+shift+b', false)).toBeNull()
    expect(resolveFixedEditorShortcut('ctrl+alt+z', false)).toBeNull()
  })
})
