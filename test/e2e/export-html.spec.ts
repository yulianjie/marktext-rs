import { expect, test, type Page } from '@playwright/test'

async function generateHtml(page: Page, markdown: string) {
  await page.goto('/')
  return page.evaluate(async source => {
    const { default: ExportHtml } = await import('/src/muya/lib/utils/exportHtml.js')
    const muya = {
      options: {
        superSubScript: false,
        footnote: false,
        isGitlabCompatibilityEnabled: false,
        mermaidTheme: 'default',
        sequenceTheme: 'hand',
      },
    }
    const exporter = new ExportHtml(source, muya)
    return exporter.generate({
      title: 'Export test',
      toc: false,
      printOptimization: false,
      extraCss: '',
    })
  }, markdown)
}

test.describe('HTML export', () => {
  test('exports ordinary Markdown without loading unused diagram renderers', async ({ page }) => {
    const html = await generateHtml(page, '# Hello\n\nPlain paragraph.')

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<h1 id="hello" class="atx">Hello</h1>')
    expect(html).toContain('<p>Plain paragraph.</p>')
  })

  test('keeps a diagram code block when its renderer is blocked by CSP', async ({ page }) => {
    const html = await generateHtml(page, '```sequence\nAlice->Bob: Hello\n```')

    expect(html).toContain('language-sequence')
    expect(html).toContain('Alice-&gt;Bob: Hello')
  })

  test('keeps PlantUML source when browser compression is unavailable', async ({ page }) => {
    const html = await generateHtml(page, '```plantuml\nAlice -> Bob: Hello\n```')

    expect(html).toContain('language-plantuml')
    expect(html).toContain('Alice -&gt; Bob: Hello')
  })

  test('renders Mermaid without loading the CSP-incompatible Sequence renderer', async ({ page }) => {
    const html = await generateHtml(page, '```mermaid\ngraph TD; A-->B;\n```')

    expect(html).toContain('<svg')
    expect(html).toContain('flowchart')
  })
})
