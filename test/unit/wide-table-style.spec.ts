import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(fileURLToPath(new URL(
  '../../src/muya/lib/assets/styles/index.css',
  import.meta.url,
)), 'utf8')

describe('wide report table styling', () => {
  it('keeps non-active wide tables inside a dedicated horizontal scroller', () => {
    expect(styles).toMatch(/figure\[data-role=TABLE\]:not\(\.ag-active\)\s*\{[\s\S]*?overflow-x:\s*auto;/)
    expect(styles).toMatch(/figure\[data-role=TABLE\]:not\(\.ag-active\)\s*>\s*table\s*\{[\s\S]*?width:\s*max-content;/)
  })

  it('distinguishes table headers and hovered rows without rewriting content', () => {
    expect(styles).toContain('background: color-mix(in srgb, var(--themeColor) 7%, var(--editorBgColor));')
    expect(styles).toContain('figure[data-role=TABLE] tbody tr:hover td')
  })
})
