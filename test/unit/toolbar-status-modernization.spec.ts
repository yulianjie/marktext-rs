import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const toolbar = readSource('../../src/components/editorToolbar/EditorToolbar.vue')
const statusBar = readSource('../../src/components/statusBar/StatusBar.vue')

describe('modern editor toolbar contract', () => {
  it('consolidates paragraph levels behind one labelled menu trigger', () => {
    expect(toolbar).toContain("type ToolbarMenu = 'paragraph' | 'more'")
    expect(toolbar).toContain('data-action="paragraph-menu"')
    expect(toolbar).toContain('aria-haspopup="menu"')
    expect(toolbar).toContain('role="menuitem"')
    expect(toolbar).not.toContain('selectedParagraph')
    expect(toolbar).toContain('`heading ${level}`')
    expect(toolbar).not.toContain('class="tool-button text-button heading-button"')
  })

  it('keeps frequent editing actions visible and moves secondary actions into More', () => {
    const persistentToolbar = toolbar.slice(
      toolbar.indexOf('<nav'),
      toolbar.indexOf('<Teleport'),
    )
    const moreMenu = toolbar.slice(toolbar.indexOf('<template v-else>'))

    for (const action of ['undo', 'redo', 'format:link', 'find', 'more-menu']) {
      expect(persistentToolbar).toContain(`data-action="${action}"`)
    }
    for (const action of [
      'format:del',
      'format:inline_code',
      'format:image',
      'insert-table',
      'toggle-source',
      'toggle-focus',
      'toggle-typewriter',
    ]) {
      expect(moreMenu).toContain(`data-action="${action}"`)
      expect(persistentToolbar).not.toContain(`data-action="${action}"`)
    }

    expect(toolbar).toContain('container-type: inline-size')
    expect(toolbar).toContain('@container (max-width: 560px)')
    expect(toolbar).toMatch(/\.compact-collapsible\s*\{\s*display:\s*none;/)
    expect(toolbar).toMatch(/\.compact-menu-action\s*\{\s*display:\s*flex;/)
  })

  it('preserves the selection for pointer use and supports complete keyboard menu navigation', () => {
    expect(toolbar.match(/@mousedown\.prevent/g)?.length).toBeGreaterThanOrEqual(8)
    expect(toolbar).toContain('@keydown.down.prevent="openToolbarMenu(\'paragraph\', true)"')
    expect(toolbar).toContain('@keydown.down.prevent="openToolbarMenu(\'more\', true)"')
    for (const key of ['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(toolbar).toContain(`event.key === '${key}'`)
    }
    expect(toolbar).toContain('role="menuitemcheckbox"')
    expect(toolbar).toContain(':aria-checked="editor.sourceCodeMode"')
    expect(toolbar).toContain(':aria-checked="prefs.focus"')
    expect(toolbar).toMatch(/\.tool-button:focus-visible\s*\{/)
    expect(toolbar).toMatch(/\.menu-item:focus-visible\s*\{/)
  })
})

describe('modern status bar contract', () => {
  it('keeps statistics quiet while announcing only meaningful save-state changes', () => {
    expect(statusBar).toContain('class="status-section document-stats"')
    expect(statusBar).not.toContain('class="status-section document-stats" aria-live')
    expect(statusBar.match(/aria-live=/g)).toHaveLength(1)
    expect(statusBar).toContain('data-status="save-state"')
    expect(statusBar).toContain('role="status"')
    expect(statusBar).toContain('aria-atomic="true"')
  })

  it('prioritizes save and editing modes without inventing cursor coordinates', () => {
    expect(statusBar).toContain('v-if="prefs.autoSave"')
    expect(statusBar).toContain('data-status="editor-mode"')
    expect(statusBar).toContain('data-status="focus-mode"')
    expect(statusBar).toContain('data-status="typewriter-mode"')
    expect(statusBar).not.toMatch(/(?:cursorLine|cursorColumn|lineNumber|columnNumber)/)
    expect(statusBar).toMatch(/\.status-bar\s*\{[\s\S]*?font-size:\s*12px;/)
    expect(statusBar).toContain('container-type: inline-size')
    expect(statusBar).toMatch(/@container \(max-width: 660px\)[\s\S]*?\.document-settings,[\s\S]*?display:\s*none;/)
  })
})
