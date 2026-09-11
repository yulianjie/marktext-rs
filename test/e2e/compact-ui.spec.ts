import { test, expect, type Page } from '@playwright/test'

const sample = [
  '# 把想法写下来',
  '一些零散的念头，和一个慢慢成形的计划。',
  '## 开始之前',
  '不必等到思路完整才开始。先记下一个句子、一段对话，或者今天观察到的小事。文字会带着我们找到下一步。',
  '> 好的记录，是给未来的自己留一条线索。',
  '## 让记录更轻一点',
  '用标题整理思路，用列表收集行动。留下一点空白，让新的想法随时有地方落下。',
  '## 下一步',
  '- [x] 整理这一周的灵感\n- [ ] 选一个值得继续展开的主题\n- [ ] 写下第一段，不急着修改',
].join('\n\n')

async function openDocument(page: Page) {
  await page.goto('/')
  await page.locator('.muya-host [contenteditable="true"]').waitFor()
  await page.evaluate(async markdown => {
    const editorPath = '/src/stores/editor.ts'
    const prefsPath = '/src/stores/preferences.ts'
    const { useEditorStore } = await import(editorPath)
    const { usePreferencesStore } = await import(prefsPath)
    const prefs = usePreferencesStore()
    Object.assign(prefs, {
      language: 'zh-CN', theme: 'light', editorLineWidth: '', autoSave: false,
      sideBarVisibility: true, tabBarVisibility: true, toolBarVisibility: true,
      statusBarVisibility: true, focus: false, typewriter: false,
    })
    const editor = useEditorStore()
    const tab = editor.newUntitledTab(markdown)
    tab.filename = '写作笔记.md'
    tab.pathname = 'C:\\Notes\\写作笔记.md'
    tab.isSaved = true
    tab.pendingBaselineUpdate = true
    editor.tabs = [tab]
  }, sample)
  await expect(page.locator('.toc-row')).toHaveCount(4)
}

test('compact layout matches the approved dimensions with and without the sidebar', async ({ page }) => {
  await openDocument(page)
  for (const width of [1200, 1024, 800]) {
    await page.setViewportSize({ width, height: 900 })
    for (const sidebar of [true, false]) {
      if (await page.locator('.sidebar-toggle').getAttribute('aria-expanded') !== String(sidebar)) {
        await page.locator('.sidebar-toggle').click()
      }
      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
        const title = rect('.title-bar'), tabs = rect('.tabs-bar'), toolbar = rect('.editor-toolbar')
        const stage = rect('.editor-stage'), status = rect('.status-bar'), editor = rect('.editor-column')
        const host = getComputedStyle(document.querySelector('.muya-host')!)
        const content = getComputedStyle(document.querySelector('.muya-container')!)
        const lastTab = document.querySelector('.tab-shell:last-child')!.getBoundingClientRect()
        return {
          titleHeight: title.height, tabsHeight: tabs.height, toolbarHeight: toolbar.height,
          stageTop: stage.top, statusHeight: status.height, statusLeft: status.left, statusWidth: status.width,
          editorLeft: editor.left, padding: [host.paddingTop, content.paddingLeft, content.paddingRight],
          firstHeadingTop: rect('.muya-host h1').top - stage.top,
          sidebarWidth: document.querySelector('.side-bar')?.getBoundingClientRect().width ?? 0,
          newTabGap: rect('.new-tab').left - lastTab.right,
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
          toolbarOverflow: document.querySelector('.toolbar-scroll')!.scrollWidth - toolbar.width,
        }
      })
      expect(geometry.titleHeight).toBe(36)
      expect(geometry.tabsHeight).toBe(32)
      expect(geometry.toolbarHeight).toBe(34)
      expect(geometry.stageTop).toBe(102)
      expect(geometry.statusHeight).toBe(24)
      expect(geometry.statusLeft).toBe(0)
      expect(geometry.statusWidth).toBe(width)
      expect(geometry.sidebarWidth).toBe(sidebar ? 264 : 0)
      expect(geometry.editorLeft).toBe(sidebar ? 264 : 0)
      expect(geometry.padding).toEqual(['24px', '24px', '24px'])
      expect(geometry.firstHeadingTop).toBe(24)
      expect(geometry.newTabGap).toBeGreaterThanOrEqual(0)
      expect(geometry.newTabGap).toBeLessThanOrEqual(8)
      expect(geometry.pageOverflow).toBe(false)
      expect(geometry.toolbarOverflow).toBeLessThanOrEqual(1)
      await expect(page.locator('.editor-toolbar [data-action="find"]')).toBeInViewport()
      if (width === 1200) await page.screenshot({ path: `output/design/compact-${sidebar ? 'sidebar' : 'writing'}.png` })
    }
  }
})

test('save and mode labels stay read-only and reflect real state changes', async ({ page }) => {
  await openDocument(page)
  const save = page.locator('[data-status="save-state"]')
  const mode = page.locator('[data-status="editor-mode"]')
  await expect(save).toHaveText('已保存')
  await expect(mode).toHaveText('所见即所得')
  await expect(page.locator('.status-bar button, .status-bar [tabindex]')).toHaveCount(0)
  for (const label of [save, mode]) {
    await expect(label).toHaveCSS('border-width', '0px')
    await expect(label).toHaveCSS('border-radius', '0px')
    await expect(label).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(label).toHaveCSS('cursor', 'default')
    const color = await label.evaluate(element => getComputedStyle(element).color)
    await label.hover()
    await expect(label).toHaveCSS('color', color)
    await expect(label).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  }
  const editable = page.locator('.muya-host [contenteditable="true"]')
  await editable.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' updated')
  await expect(save).toHaveText('未保存')
  await page.locator('[data-action="more-menu"]').click()
  await page.locator('.toolbar-menu [data-action="toggle-source"]').click()
  await expect(mode).toHaveText('源码')
  await expect(page.locator('.source-pane')).toBeVisible()
  await page.locator('[data-action="more-menu"]').click()
  await page.locator('.toolbar-menu [data-action="toggle-source"]').click()
  await expect(editable).toContainText('updated')
})

test('explicit line width and resized sidebar survive layout toggles', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 })
  await openDocument(page)
  await page.evaluate(async () => {
    const prefsPath = '/src/stores/preferences.ts'
    const layoutPath = '/src/stores/layout.ts'
    const { usePreferencesStore } = await import(prefsPath)
    const { useLayoutStore } = await import(layoutPath)
    usePreferencesStore().editorLineWidth = '640px'
    useLayoutStore().setSideBarWidth(300)
  })
  await expect(page.locator('.muya-container')).toHaveCSS('max-width', '640px')
  await expect(page.locator('.panel')).toHaveCSS('width', '300px')
  await page.locator('.sidebar-toggle').click()
  await expect(page.locator('.muya-container')).toHaveCSS('max-width', '640px')
  await page.locator('.sidebar-toggle').click()
  await expect(page.locator('.panel')).toHaveCSS('width', '300px')
  await page.locator('.resizer').press('ArrowRight')
  await expect(page.locator('.panel')).toHaveCSS('width', '316px')
  await page.evaluate(async () => {
    const prefsPath = '/src/stores/preferences.ts'
    const { usePreferencesStore } = await import(prefsPath)
    usePreferencesStore().editorLineWidth = ''
    usePreferencesStore().theme = 'dark'
  })
  await expect(page.locator('.muya-container')).toHaveCSS('max-width', 'none')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'output/design/compact-dark.png' })
  await page.locator('.new-tab').click()
  await expect(page.locator('.muya-host [contenteditable="true"]')).toHaveText('')
  await page.screenshot({ path: 'output/design/compact-empty-dark.png' })
})
