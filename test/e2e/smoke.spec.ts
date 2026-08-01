/**
 * Smoke tests — verify the renderer boots and the basic UI surfaces are
 * present. Doesn't drive Tauri-specific commands (those need the binary
 * + tauri-driver); checks renderer-only happy paths.
 *
 * The tests intentionally don't depend on file-system actions so they pass
 * in CI without preferences/store fixtures.
 */
import { test, expect } from '@playwright/test'

test('renderer boots and shows the editor page', async ({ page }) => {
  await page.goto('/')
  // The TitleBar word-count label is the most reliable "boot ok" signal —
  // if Pinia or Muya failed, this never shows up.
  await expect(page.locator('.title-bar')).toBeVisible({ timeout: 10_000 })
  // The canonical preference hides the optional tab bar by default. Assert
  // the editor surface instead so this smoke test does not contradict it.
  await expect(page.locator('.editor-stage')).toBeVisible()
})

test('command palette opens with Ctrl+Shift+P', async ({ page }) => {
  await page.goto('/')
  await page.locator('.title-bar').waitFor()
  await page.keyboard.press('Control+Shift+P')
  await expect(page.locator('.cp-input')).toBeVisible()
})

test('source-code mode toggle wires to the editor', async ({ page }) => {
  await page.goto('/')
  await page.locator('.title-bar').waitFor()
  // Open the command palette and run "Toggle Source Code Mode"
  await page.keyboard.press('Control+Shift+P')
  const input = page.locator('.cp-input')
  await input.fill('source')
  await page.keyboard.press('Enter')
  await expect(page.locator('.source-pane')).toBeVisible()
})
