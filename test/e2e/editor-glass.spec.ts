import { test, expect, type Page } from '@playwright/test'

const markdown = [
  '# 高德地图综合服务 Skill',
  '高德地图综合服务向开发者提供完整的地图数据服务，包括地点搜索、路径规划、旅游规划、周边搜索和热力图数据可视化等功能。',
  '## Skill App Name / 统计口径',
  '- SKILL_NAME = gaode-map-lbs\n- APP_NAME = gaode-map-lbs',
  '## 功能特性', '支持关键词搜索和周边搜索。',
  '## 场景一：明确关键词搜索', '用户通过关键词搜索地点，返回结构化的地图结果。',
  '### 执行步骤', '输入地点关键词，然后选择城市。',
  '### 示例', '```yaml\nname: gaode-map-lbs\nversion: 2.0.1\nmetadata:\n  requires:\n    - node\n    - python3\n```',
  '### 回复模板', '根据搜索结果整理地点、地址和交通信息。',
  '## 场景二：基于位置的周边搜索',
  ...Array.from({ length: 18 }, (_, index) => '段落 ' + index + '：提供清晰可读的地图检索说明。'),
  '### 完整示例', '搜索当前位置附近的公园。',
  '## 场景三：热力图展示', '展示区域热力图。'
].join('\n\n')

async function seed(page: Page) {
  await page.goto('/')
  await page.locator('.muya-host [contenteditable="true"]').waitFor()
  await page.evaluate(async (content) => {
    const editorPath = '/src/stores/editor.ts'
    const prefsPath = '/src/stores/preferences.ts'
    const layoutPath = '/src/stores/layout.ts'
    const { useEditorStore } = await import(editorPath)
    const { usePreferencesStore } = await import(prefsPath)
    const { useLayoutStore } = await import(layoutPath)
    const prefs = usePreferencesStore()
    prefs.language = 'zh-CN'
    prefs.sideBarVisibility = true
    prefs.tabBarVisibility = true
    prefs.toolBarVisibility = true
    prefs.statusBarVisibility = true
    prefs.autoSave = false
    const editor = useEditorStore()
    editor.sourceCodeMode = false
    const tab = editor.newUntitledTab(content)
    tab.filename = 'SKILL.md'
    useLayoutStore().rightColumn = 'toc'
  }, markdown)
  await expect(page.locator('.toc-row')).toHaveCount(10)
}

test('glass outline filters, expands, navigates and tracks real scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 1040 })
  await seed(page)
  await expect(page.locator('.title-bar [role="menuitem"]')).toHaveCount(8)
  await expect(page.locator('.breadcrumb')).toHaveCount(0)

  const branch = page.getByRole('button', { name: '折叠 场景一：明确关键词搜索', exact: true })
  await branch.click()
  await expect(page.locator('.toc-row')).toHaveCount(7)
  const search = page.locator('.toc-search input')
  await search.fill('回复模板')
  await expect(page.locator('.toc-row')).toHaveCount(3)
  await expect(page.locator('.toc-row').last()).toHaveText('H3回复模板')
  await search.fill('不存在的标题')
  await expect(page.locator('.toc-list')).toContainText('没有匹配的标题')
  await search.press('Escape')
  await expect(page.locator('.toc-row')).toHaveCount(7)
  await page.getByRole('button', { name: '展开 场景一：明确关键词搜索', exact: true }).click()
  await expect(page.locator('.toc-row')).toHaveCount(10)

  const chapter = page.getByRole('button', { name: 'H2: 场景一：明确关键词搜索', exact: true })
  await chapter.focus()
  await chapter.press('ArrowDown')
  await expect(page.getByRole('button', { name: 'H3: 执行步骤', exact: true })).toBeFocused()
  await chapter.click()
  await expect(chapter).toHaveAttribute('aria-current', 'location')
  await expect.poll(() => page.locator('.muya-host').evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  await page.locator('.muya-host').evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(page.locator('.toc-progress progress')).toHaveAttribute('value', '100')

  await page.locator('.muya-host').evaluate(el => { el.scrollTop = 0 })
  await page.mouse.move(1500, 1030)
  await page.screenshot({ path: 'output/design/marktext-glass-implemented.png', animations: 'disabled' })
  await page.getByRole('button', { name: '收起目录', exact: true }).click()
  await expect(page.locator('.toc-pane')).toHaveCount(0)
  await page.locator('.rail-icon[aria-controls="toc-sidebar-panel"]').click()
  await expect(page.locator('.toc-pane')).toBeVisible()
})

test('search remains reachable in a narrow window and dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 650 })
  await seed(page)
  const find = page.locator('.editor-toolbar > .toolbar-scroll [data-action="find"]')
  await expect(find).toBeVisible()
  const box = await find.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(800)
  await find.click()
  await expect(page.locator('.find-bar')).toBeVisible()
  const findBox = await page.locator('.find-bar').boundingBox()
  const stageBox = await page.locator('.editor-stage').boundingBox()
  expect(findBox!.x).toBeGreaterThanOrEqual(stageBox!.x)
  await page.evaluate(async () => {
    const path = '/src/stores/preferences.ts'
    const { usePreferencesStore } = await import(path)
    usePreferencesStore().theme = 'dark'
  })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'output/design/marktext-glass-dark-800.png', animations: 'disabled' })
})
