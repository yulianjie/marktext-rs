import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import formatPickerIcons from '../../src/muya/lib/ui/formatPicker/config.js'
import { menu as frontMenu } from '../../src/muya/lib/ui/frontMenu/config.js'
import { quickInsertObj } from '../../src/muya/lib/ui/quickInsert/config.js'
import { getShortcutDefault } from '../../src/common/shortcut-registry'

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

describe('shortcut registry UI contract', () => {
  it('shows only registered quick-insert and format-picker shortcuts', () => {
    const quickItems = Object.values(quickInsertObj).flat() as Array<{
      label: string
      shortCut?: string
    }>
    const quickShortcuts = quickItems
      .filter(item => item.shortCut)
      .map(item => [item.label, item.shortCut])
    expect(quickShortcuts).toEqual([
      ['heading 1', getShortcutDefault('paragraph.h1')],
      ['heading 2', getShortcutDefault('paragraph.h2')],
      ['heading 3', getShortcutDefault('paragraph.h3')],
      ['heading 4', getShortcutDefault('paragraph.h4')],
      ['heading 5', getShortcutDefault('paragraph.h5')],
      ['heading 6', getShortcutDefault('paragraph.h6')],
    ])

    const formatShortcuts = (formatPickerIcons as Array<{ shortcut?: string }>)
      .filter(item => item.shortcut)
      .map(item => item.shortcut)
    expect(formatShortcuts).toEqual([
      getShortcutDefault('format.bold'),
      getShortcutDefault('format.italic'),
      getShortcutDefault('format.strikethrough'),
      getShortcutDefault('format.inlineCode'),
      getShortcutDefault('format.link'),
      getShortcutDefault('format.image'),
    ])
    expect((frontMenu as Array<Record<string, unknown>>).some(item => 'shortCut' in item)).toBe(false)
  })

  it('uses an explicit refocus request instead of a one-way visibility flag', () => {
    const editorPage = readSource('../../src/pages/EditorPage.vue')
    const findReplace = readSource('../../src/components/search/FindReplaceBar.vue')

    expect(editorPage).toContain("bus.emit('request-find-replace', { mode: 'find' })")
    expect(editorPage).toContain("bus.emit('request-find-replace', { mode: 'replace' })")
    expect(findReplace).toContain("bus.on('request-find-replace', request => { void requestOpen(request.mode) })")
    expect(findReplace).toContain("const input = mode === 'replace' ? replaceInput.value : findInput.value")
  })

  it('derives title-bar access keys, agent hints, and palette key labels from the registry', () => {
    const titleBar = readSource('../../src/components/titleBar/TitleBar.vue')
    const editorPage = readSource('../../src/pages/EditorPage.vue')

    expect(titleBar).toContain("getShortcutDefault('view.toggleAgent')")
    expect(titleBar).toContain("scope: 'titlebar'")
    expect(titleBar).toContain('dispatch: \'titlebar\'')
    expect(titleBar).not.toContain("'fepovtwh'")
    expect(titleBar).not.toContain('Ctrl/Cmd+Shift+A')
    expect(editorPage).toContain('getShortcutAccelerators(declaration, platform)')
    expect(editorPage).toContain('displayAccelerator(accelerator, platform)')
  })

  it('records only command-modified Tab and Escape while retaining Shift navigation/cancel semantics', () => {
    const preferences = readSource('../../src/pages/PreferencesPage.vue')
    expect(preferences).toContain('const hasCommandModifier = ev.ctrlKey || ev.metaKey || ev.altKey')
    expect(preferences).toContain("if (ev.key === 'Escape' && !hasCommandModifier)")
    expect(preferences).toContain("if (ev.key === 'Tab' && !hasCommandModifier) return")
    expect(preferences).toContain('serialiseAccelerator(eventAccel(ev, shortcutPlatform))')
    expect(preferences).toContain(':value="displayAccelerator(recordedAccel, shortcutPlatform)"')
  })

  it('derives Muya context-menu labels from the registry, including platform redo alternatives', () => {
    const muyaEditor = readSource('../../src/components/editorWithTabs/MuyaEditor.vue')
    expect(muyaEditor).toContain("getShortcutAccelerators(actionId, platform)")
    expect(muyaEditor).toContain("shortcut('edit.redo')")
    expect(muyaEditor).not.toContain("isMac ? '⇧⌘Z' : 'Ctrl+Y'")
  })
})
