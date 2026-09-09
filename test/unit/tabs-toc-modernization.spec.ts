import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const tabs = readSource('../../src/components/editorWithTabs/TabsBar.vue')
const title = readSource('../../src/components/titleBar/TitleBar.vue')
const schema = JSON.parse(readSource('../../src/common/preferences-schema.json')) as Record<string, { default?: unknown }>
const legacyDefaults = JSON.parse(readSource('../../static/preference.json')) as Record<string, unknown>

describe('modern editor navigation chrome', () => {
  it('shows the existing tab surface by default for fresh profiles', () => {
    expect(schema.tabBarVisibility.default).toBe(true)
    expect(legacyDefaults.tabBarVisibility).toBe(true)
  })

  it('exposes tabs as a keyboard-operable ARIA tablist', () => {
    expect(tabs).toContain('role="tablist"')
    expect(tabs).toContain('role="tab"')
    expect(tabs).toContain(':aria-selected="tab.id === editor.currentFileId"')
    expect(tabs).toContain("ev.key === 'ArrowRight'")
    expect(tabs).toContain("ev.key === 'ArrowLeft'")
    expect(tabs).toContain("ev.key === 'Home'")
    expect(tabs).toContain("ev.key === 'End'")
    expect(tabs).toMatch(/\.close\s*\{[\s\S]*?width:\s*24px;[\s\S]*?height:\s*24px;/)
  })

  // Outline navigation is exercised against the rendered editor in
  // test/e2e/editor-glass.spec.ts, including filtering and collapsed branches.
  it('uses a unified menu title bar without exposing the document path', () => {
    expect(title).toContain('role="menubar"')
    expect(title).toContain('<button')
    expect(title).not.toContain('class="breadcrumb"')
    expect(title).not.toContain('pathname')
    expect(title).not.toContain('class="word-count"')
  })
})
