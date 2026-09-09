import { test, expect } from '@playwright/test'

// Real DOM/editor/store routing with mocked IPC; this does not drive WebView2.
test('Save and Save As reach IPC once from Muya and CodeMirror', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.muya-host [contenteditable="true"]')
  await editor.waitFor()
  await page.evaluate(() => {
    const state = window as unknown as {
      __TAURI_INTERNALS__: unknown
      shortcutCalls: { cmd: string; args: Record<string, unknown> }[]
    }
    state.shortcutCalls = []
    state.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: Record<string, unknown>) => {
        state.shortcutCalls.push({ cmd, args })
        if (cmd === 'cmd_save_as_dialog') return 'C:\\shortcut-test\\document.md'
        return null
      },
    }
  })
  await editor.click()
  await page.keyboard.type('shortcut save regression')
  await page.keyboard.press('Control+s')
  const calls = () => page.evaluate(() => (window as unknown as {
    shortcutCalls: { cmd: string; args: Record<string, unknown> }[]
  }).shortcutCalls)
  await expect.poll(async () => (await calls()).filter(c => c.cmd === 'cmd_save_markdown').length).toBe(1)
  expect((await calls()).find(c => c.cmd === 'cmd_save_markdown')?.args.markdown).toContain('shortcut save regression')
  expect((await calls()).filter(c => c.cmd === 'cmd_save_as_dialog')).toHaveLength(1)

  await page.keyboard.press('Control+Shift+s')
  await expect.poll(async () => (await calls()).filter(c => c.cmd === 'cmd_save_markdown').length).toBe(2)
  expect((await calls()).filter(c => c.cmd === 'cmd_save_as_dialog')).toHaveLength(2)

  await page.keyboard.press('Control+Shift+p')
  await page.locator('.cp-input').fill('source')
  await page.keyboard.press('Enter')
  const source = page.locator('.source-pane .cm-content')
  await source.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' source edit')
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await calls()).filter(c => c.cmd === 'cmd_save_markdown').length).toBe(3)
  expect((await calls()).filter(c => c.cmd === 'cmd_save_markdown')[2].args.markdown).toContain('source edit')
  expect((await calls()).filter(c => c.cmd === 'cmd_save_as_dialog')).toHaveLength(2)
})
