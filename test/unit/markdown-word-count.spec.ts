import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
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

import { computeMarkdownWordCount } from '../../src/services/markdown-word-count'
import { publishSourceDocumentChange } from '../../src/services/source-editor-state'
import { useEditorStore } from '../../src/stores/editor'
import { getFileStateFromData } from '../../src/stores/help'

describe('markdown word count', () => {
  it('matches Muya semantics for Unicode, whitespace, Markdown markers and paragraphs', () => {
    expect(computeMarkdownWordCount('# Hello **world**\r\n\r\n你好 café')).toEqual({
      paragraph: 2,
      word: 6,
      character: 21,
      all: 26,
    })
    expect(computeMarkdownWordCount('naïve  👋')).toEqual({
      paragraph: 1,
      word: 2,
      character: 7,
      all: 9,
    })
    expect(computeMarkdownWordCount(' \t\n')).toEqual({
      paragraph: 1,
      word: 0,
      character: 0,
      all: 3,
    })
    expect(computeMarkdownWordCount('')).toEqual({
      paragraph: 1,
      word: 0,
      character: 0,
      all: 0,
    })
  })
})

describe('SourceCodePane word-count integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('publishes CodeMirror transactions into live tab statistics and lets Muya override them', () => {
    const editor = useEditorStore()
    const tab = getFileStateFromData({
      markdown: '',
      pathname: 'C:\\notes\\draft.md',
      filename: 'draft.md',
      encoding: { encoding: 'utf8', isBom: false },
      lineEnding: 'lf',
    })
    editor.tabs.push(tab)
    editor.currentFileId = tab.id

    let state = EditorState.create({ doc: '' })
    const insert = state.update({
      changes: { from: 0, insert: '# Hello **world**\n\n你好 café' },
    })
    state = insert.state
    publishSourceDocumentChange(insert, tab.id, editor.setMarkdownExternal)

    expect(tab.markdown).toBe(state.doc.toString())
    expect(tab.wordCount).toEqual({ paragraph: 2, word: 6, character: 21, all: 26 })

    const clear = state.update({ changes: { from: 0, to: state.doc.length, insert: '' } })
    publishSourceDocumentChange(clear, tab.id, editor.setMarkdownExternal)
    expect(tab.wordCount).toEqual({ paragraph: 1, word: 0, character: 0, all: 0 })

    const muyaPayload = { paragraph: 4, word: 12, character: 34, all: 56 }
    editor.applyContentChange(tab.id, '', { wordCount: muyaPayload })
    expect(tab.wordCount).toBe(muyaPayload)
  })
})
