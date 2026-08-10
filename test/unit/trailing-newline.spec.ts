import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const invokeMocks = vi.hoisted(() => ({
  readMarkdown: vi.fn(),
  saveMarkdown: vi.fn(),
  saveAsDialog: vi.fn(),
  renameFile: vi.fn(),
  pushRecentPath: vi.fn(),
  getPreferences: vi.fn(),
  setPreference: vi.fn(),
  setPreferences: vi.fn(),
  getUserData: vi.fn(),
  setUserData: vi.fn(),
}))

vi.mock('@/services/tauri-invoke', () => invokeMocks)
vi.mock('element-plus', () => ({
  ElMessageBox: { confirm: vi.fn() },
  ElNotification: vi.fn(),
}))

import preferenceSchema from '../../src/common/preferences-schema.json'
import en from '../../src/i18n/en'
import ja from '../../src/i18n/ja'
import zhCN from '../../src/i18n/zh-CN'
import {
  adjustTrailingNewlines,
  detectTrailingNewlinePolicy,
  normalizeMarkdown,
  normalizeMarkdownLineEndings,
  resolveTrailingNewlinePolicy,
} from '../../src/services/trailing-newline'
import { useEditorStore } from '../../src/stores/editor'
import { usePreferencesStore } from '../../src/stores/preferences'

function loaded(markdown: string, lineEnding = 'lf') {
  return {
    path: 'C:\\notes\\draft.md',
    markdown,
    encoding: 'UTF-8',
    lineEnding,
    hadDecodeErrors: false,
    bom: false,
  }
}

describe('trailing-newline helpers', () => {
  it.each([
    ['', 3],
    ['body', 0],
    ['body\n', 1],
    ['body\r\n', 1],
    ['body\n\n', 2],
    ['body\r\n\r\n', 2],
  ] as const)('detects %j as policy %i', (markdown, expected) => {
    expect(detectTrailingNewlinePolicy(markdown)).toBe(expected)
    expect(resolveTrailingNewlinePolicy(2, markdown)).toBe(expected)
  })

  it('applies all four policies without creating a newline for empty text', () => {
    expect(adjustTrailingNewlines('body\r\n\n', 0)).toBe('body')
    expect(adjustTrailingNewlines('body\r\n\n', 1)).toBe('body\n')
    expect(adjustTrailingNewlines('body\r\n\n', 2)).toBe('body\r\n\n')
    expect(adjustTrailingNewlines('body\r\n\n', 3)).toBe('body\r\n\n')
    expect(adjustTrailingNewlines('\r\n', 1)).toBe('')
    expect(adjustTrailingNewlines('', 1)).toBe('')
  })

  it('uses LF for the editor while preserving the selected trailing style', () => {
    expect(normalizeMarkdownLineEndings('one\r\ntwo\r\n')).toBe('one\ntwo\n')
    expect(normalizeMarkdown('one\r\ntwo\r\n\r\n', 2)).toBe('one\ntwo\n\n')
    expect(normalizeMarkdown('one\r\ntwo\r\n\r\n', 1)).toBe('one\ntwo\n')
  })
})

describe('editor trailing-newline integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    invokeMocks.saveMarkdown.mockResolvedValue(undefined)
    invokeMocks.pushRecentPath.mockResolvedValue([])
  })

  it('detects a CRLF file once, stores LF internally, and keeps its baseline identical', async () => {
    const prefs = usePreferencesStore()
    prefs.trimTrailingNewline = 2
    invokeMocks.readMarkdown.mockResolvedValue(loaded('first\r\nsecond\r\n', 'crlf'))

    const editor = useEditorStore()
    const tab = await editor.openFile('C:\\notes\\draft.md')

    expect(tab.trimTrailingNewline).toBe(1)
    expect(tab.markdown).toBe('first\nsecond\n')
    expect(tab.lastSavedMarkdown).toBe(tab.markdown)
    expect(tab.lineEnding).toBe('crlf')

    editor.applyContentChange(tab.id, 'first\nsecond\n')
    expect(tab.pendingBaselineUpdate).toBe(false)
    expect(tab.lastSavedMarkdown).toBe(tab.markdown)
    expect(tab.isSaved).toBe(true)
  })

  it('keeps consecutive EOF Enter edits in both Muya and source mode', () => {
    const prefs = usePreferencesStore()
    prefs.trimTrailingNewline = 0
    const editor = useEditorStore()
    const sourceTab = editor.newUntitledTab()
    editor.setMarkdownExternal(sourceTab.id, 'body\n')
    editor.setMarkdownExternal(sourceTab.id, 'body\n\n')

    prefs.trimTrailingNewline = 1
    const muyaTab = editor.newUntitledTab()
    editor.applyContentChange(muyaTab.id, 'body\n')
    editor.applyContentChange(muyaTab.id, 'body\r\n\r\n')

    expect(muyaTab.markdown).toBe('body\n\n')
    expect(sourceTab.markdown).toBe('body\n\n')
    expect(muyaTab.isSaved).toBe(false)
    expect(sourceTab.isSaved).toBe(false)
  })

  it('does not let a source edit be consumed as Muya\'s initial baseline', async () => {
    const prefs = usePreferencesStore()
    prefs.trimTrailingNewline = 1
    invokeMocks.readMarkdown.mockResolvedValue(loaded('disk\n'))
    const editor = useEditorStore()
    const tab = await editor.openFile('C:\\notes\\draft.md')

    editor.setMarkdownExternal(tab.id, 'source edit')
    editor.applyContentChange(tab.id, 'second edit')

    expect(tab.pendingBaselineUpdate).toBe(false)
    expect(tab.markdown).toBe('second edit')
    expect(tab.lastSavedMarkdown).toBe('disk\n')
    expect(tab.isSaved).toBe(false)
  })

  it('keeps the actual disk baseline when Muya adds a policy-equivalent newline', async () => {
    const prefs = usePreferencesStore()
    prefs.trimTrailingNewline = 1
    invokeMocks.readMarkdown.mockResolvedValue(loaded('disk'))
    const editor = useEditorStore()
    const tab = await editor.openFile('C:\\notes\\draft.md')

    editor.applyContentChange(tab.id, 'disk\n')

    expect(tab.markdown).toBe('disk\n')
    expect(tab.lastSavedMarkdown).toBe('disk')
    expect(tab.isSaved).toBe(true)
  })

  it('ignores Muya synthetic newline for an empty document', () => {
    const prefs = usePreferencesStore()
    prefs.trimTrailingNewline = 2
    const editor = useEditorStore()
    const tab = editor.newUntitledTab()

    expect(tab.trimTrailingNewline).toBe(3)
    editor.applyContentChange(tab.id, '\n')

    expect(tab.markdown).toBe('')
    expect(tab.lastSavedMarkdown).toBe('')
    expect(tab.isSaved).toBe(true)
  })

  it('writes and records the exact same normalized snapshot', async () => {
    const prefs = usePreferencesStore()
    prefs.trimTrailingNewline = 1
    const editor = useEditorStore()
    const tab = editor.newUntitledTab()
    tab.pathname = 'C:\\notes\\draft.md'
    tab.filename = 'draft.md'
    editor.setMarkdownExternal(tab.id, 'body\r\n\r\n')

    await expect(editor.saveTab(tab)).resolves.toBe(true)

    expect(invokeMocks.saveMarkdown).toHaveBeenCalledWith(
      tab.pathname,
      'body\n',
      expect.objectContaining({ lineEnding: tab.lineEnding }),
    )
    expect(tab.markdown).toBe('body\n')
    expect(tab.lastSavedMarkdown).toBe('body\n')
    expect(tab.isSaved).toBe(true)
  })

  it('does not mutate the editor snapshot when the write fails', async () => {
    const prefs = usePreferencesStore()
    prefs.trimTrailingNewline = 0
    invokeMocks.saveMarkdown.mockRejectedValueOnce(new Error('disk full'))
    const editor = useEditorStore()
    const tab = editor.newUntitledTab()
    tab.pathname = 'C:\\notes\\draft.md'
    tab.filename = 'draft.md'
    editor.setMarkdownExternal(tab.id, 'body\n\n')

    await expect(editor.saveTab(tab)).resolves.toBe(false)

    expect(tab.markdown).toBe('body\n\n')
    expect(tab.lastSavedMarkdown).toBe('')
    expect(tab.isSaved).toBe(false)
  })

  it('does not overwrite a newer edit when an older normalized save completes', async () => {
    let finishWrite!: () => void
    invokeMocks.saveMarkdown.mockImplementationOnce(() => new Promise<void>(resolve => {
      finishWrite = resolve
    }))
    const prefs = usePreferencesStore()
    prefs.trimTrailingNewline = 1
    const editor = useEditorStore()
    const tab = editor.newUntitledTab()
    tab.pathname = 'C:\\notes\\draft.md'
    tab.filename = 'draft.md'
    editor.setMarkdownExternal(tab.id, 'first\n\n')

    const saving = editor.saveTab(tab)
    await vi.waitFor(() => expect(invokeMocks.saveMarkdown).toHaveBeenCalled())
    editor.setMarkdownExternal(tab.id, 'newer\n\n\n')
    finishWrite()
    await expect(saving).resolves.toBe(true)

    expect(tab.lastSavedMarkdown).toBe('first\n')
    expect(tab.markdown).toBe('newer\n\n\n')
    expect(tab.isSaved).toBe(false)
  })

  it('keeps the fixed policy while an external reload preserves editable blank lines', async () => {
    const prefs = usePreferencesStore()
    prefs.trimTrailingNewline = 1
    invokeMocks.readMarkdown.mockResolvedValueOnce(loaded('old\r\n', 'crlf'))
    const editor = useEditorStore()
    const tab = await editor.openFile('C:\\notes\\draft.md')
    editor.applyContentChange(tab.id, tab.markdown)

    invokeMocks.readMarkdown.mockResolvedValueOnce(loaded('new\r\n\r\n', 'crlf'))
    await editor.handleFileWatchEvent({ kind: 'modified', path: tab.pathname })

    expect(tab.trimTrailingNewline).toBe(1)
    expect(tab.markdown).toBe('new\n\n')
    expect(tab.lastSavedMarkdown).toBe('new\n\n')
    expect(tab.isSaved).toBe(true)
  })

  it('does not clear unsaved EOF blank lines on a policy-equivalent watcher event', async () => {
    const prefs = usePreferencesStore()
    prefs.trimTrailingNewline = 1
    invokeMocks.readMarkdown.mockResolvedValueOnce(loaded('body\n'))
    const editor = useEditorStore()
    const tab = await editor.openFile('C:\\notes\\draft.md')
    editor.applyContentChange(tab.id, tab.markdown)
    editor.setMarkdownExternal(tab.id, 'body\n\n')

    invokeMocks.readMarkdown.mockResolvedValueOnce(loaded('body\n'))
    await editor.handleFileWatchEvent({ kind: 'modified', path: tab.pathname })

    expect(tab.markdown).toBe('body\n\n')
    expect(tab.lastSavedMarkdown).toBe('body\n')
    expect(tab.isSaved).toBe(false)
  })

  it('only applies a changed global preference to subsequently created tabs', () => {
    const prefs = usePreferencesStore()
    prefs.trimTrailingNewline = 1
    const editor = useEditorStore()
    const existing = editor.newUntitledTab('draft')
    editor.setMarkdownExternal(existing.id, 'dirty')

    prefs.trimTrailingNewline = 0
    const next = editor.newUntitledTab('next\n')

    expect(existing.trimTrailingNewline).toBe(1)
    expect(existing.markdown).toBe('dirty')
    expect(next.trimTrailingNewline).toBe(0)
    expect(next.markdown).toBe('next\n')
  })

  it('restores a dirty draft with its persisted policy even after the global preference changes', () => {
    const prefs = usePreferencesStore()
    prefs.trimTrailingNewline = 0
    const editor = useEditorStore()
    const tab = editor.restoreDirtySessionTab({
      dirty: true,
      filename: 'Recovered.md',
      markdown: 'draft\r\n\r\n',
      lastSavedMarkdown: '',
      encoding: 'utf8',
      bom: false,
      lineEnding: 'crlf',
      trimTrailingNewline: 1,
      sourceMode: false,
    }, true)

    expect(tab.trimTrailingNewline).toBe(1)
    expect(tab.markdown).toBe('draft\n\n')
    expect(tab.lastSavedMarkdown).toBe('')
  })
})

describe('trailing-newline preference contract', () => {
  it('keeps the schema enum, four-option control, and all locale labels aligned', () => {
    expect(preferenceSchema.trimTrailingNewline).toMatchObject({
      default: 2,
      enum: [0, 1, 2, 3],
    })

    const source = readFileSync(
      new URL('../../src/pages/PreferencesPage.vue', import.meta.url),
      'utf8',
    )
    expect(source).toContain("prefs.set('trimTrailingNewline'")
    for (const value of [0, 1, 2, 3]) {
      expect(source).toContain(`:value=\"${value}\"`)
    }
    for (const messages of [en, zhCN, ja]) {
      expect(messages.prefs.editor.trimTrailingNewline).toBeTruthy()
      expect(messages.prefs.editor.trimTrailingNewlineTrimAll).toBeTruthy()
      expect(messages.prefs.editor.trimTrailingNewlineEnsureOne).toBeTruthy()
      expect(messages.prefs.editor.trimTrailingNewlinePreserve).toBeTruthy()
      expect(messages.prefs.editor.trimTrailingNewlineNothing).toBeTruthy()
    }
  })
})
