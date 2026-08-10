import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const invokeMocks = vi.hoisted(() => ({
  readMarkdown: vi.fn(),
  saveMarkdown: vi.fn(),
  saveAsDialog: vi.fn(),
  renameFile: vi.fn(),
}))
const confirm = vi.hoisted(() => vi.fn())
const notification = vi.hoisted(() => vi.fn())

vi.mock('@/services/tauri-invoke', () => invokeMocks)
vi.mock('element-plus', () => ({
  ElMessageBox: { confirm },
  ElNotification: notification,
}))

import { useEditorStore } from '../../src/stores/editor'
import { getBlankFileState, getFileStateFromData, type DocumentState } from '../../src/stores/help'

function dirtyFile(id: string, pathname: string): DocumentState {
  const tab = getFileStateFromData({
    markdown: `dirty ${id}`,
    pathname,
    filename: pathname.split(/[\\/]/).pop()!,
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
  })
  tab.id = id
  tab.lastSavedMarkdown = `saved ${id}`
  tab.isSaved = false
  return tab
}

function dirtyUntitled(id: string): DocumentState {
  const tab = getBlankFileState([], 'utf8', 'lf', `dirty ${id}`)
  tab.id = id
  tab.isSaved = false
  return tab
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('transactional tab close for project deletion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    invokeMocks.saveMarkdown.mockResolvedValue(undefined)
    invokeMocks.saveAsDialog.mockResolvedValue(null)
  })

  it('keeps every tab when an earlier discard is followed by cancel', async () => {
    const editor = useEditorStore()
    editor.tabs.push(
      dirtyFile('discard', 'C:\\notes\\drafts\\discard.md'),
      dirtyFile('cancel', 'C:\\notes\\drafts\\cancel.md'),
    )
    confirm.mockRejectedValueOnce('cancel') // Don't Save
    confirm.mockRejectedValueOnce('close') // Cancel close

    await expect(editor.closeTabsTransactionally(['discard', 'cancel'])).resolves.toBe(false)

    expect(editor.tabs.map(tab => tab.id)).toEqual(['discard', 'cancel'])
    expect(invokeMocks.saveMarkdown).not.toHaveBeenCalled()
  })

  it('keeps every tab when a requested save fails', async () => {
    const editor = useEditorStore()
    editor.tabs.push(
      dirtyFile('discard', 'C:\\notes\\drafts\\discard.md'),
      dirtyFile('save', 'C:\\notes\\drafts\\save.md'),
    )
    confirm.mockRejectedValueOnce('cancel')
    confirm.mockResolvedValueOnce(undefined)
    invokeMocks.saveMarkdown.mockRejectedValueOnce(new Error('disk full'))

    await expect(editor.closeTabsTransactionally(['discard', 'save'])).resolves.toBe(false)

    expect(editor.tabs.map(tab => tab.id)).toEqual(['discard', 'save'])
    expect(notification).toHaveBeenCalled()
  })

  it('keeps every tab when Save As is cancelled', async () => {
    const editor = useEditorStore()
    editor.tabs.push(
      dirtyFile('discard', 'C:\\notes\\drafts\\discard.md'),
      dirtyUntitled('untitled'),
    )
    confirm.mockRejectedValueOnce('cancel')
    confirm.mockResolvedValueOnce(undefined)
    invokeMocks.saveAsDialog.mockResolvedValueOnce(null)

    await expect(editor.closeTabsTransactionally(['discard', 'untitled'])).resolves.toBe(false)

    expect(editor.tabs.map(tab => tab.id)).toEqual(['discard', 'untitled'])
    expect(invokeMocks.saveMarkdown).not.toHaveBeenCalled()
  })

  it('commits removals only after every decision and save succeeds', async () => {
    const editor = useEditorStore()
    editor.tabs.push(
      dirtyFile('discard', 'C:\\notes\\drafts\\discard.md'),
      dirtyFile('save', 'C:\\notes\\drafts\\save.md'),
    )
    confirm.mockRejectedValueOnce('cancel')
    confirm.mockResolvedValueOnce(undefined)

    await expect(editor.closeTabsTransactionally(['discard', 'save'])).resolves.toBe(true)

    expect(editor.tabs).toHaveLength(0)
    expect(invokeMocks.saveMarkdown).toHaveBeenCalledOnce()
  })

  it('aborts atomically when a saved tab is edited while a later save is pending', async () => {
    const editor = useEditorStore()
    const first = dirtyFile('first', 'C:\\notes\\drafts\\first.md')
    const second = dirtyFile('second', 'C:\\notes\\drafts\\second.md')
    editor.tabs.push(first, second)
    confirm.mockResolvedValue(undefined)
    const secondWrite = deferred<void>()
    invokeMocks.saveMarkdown
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(secondWrite.promise)

    const closing = editor.closeTabsTransactionally(['first', 'second'])
    await vi.waitFor(() => expect(invokeMocks.saveMarkdown).toHaveBeenCalledTimes(2))
    editor.setMarkdownExternal('first', 'edited again while second is saving')
    secondWrite.resolve()

    await expect(closing).resolves.toBe(false)
    expect(editor.tabs.map(tab => tab.id)).toEqual(['first', 'second'])
    expect(first.isSaved).toBe(false)
  })

  it('does not apply an earlier discard decision to later edits', async () => {
    const editor = useEditorStore()
    const discard = dirtyFile('discard', 'C:\\notes\\drafts\\discard.md')
    const save = dirtyFile('save', 'C:\\notes\\drafts\\save.md')
    editor.tabs.push(discard, save)
    confirm.mockRejectedValueOnce('cancel')
    confirm.mockResolvedValueOnce(undefined)
    const write = deferred<void>()
    invokeMocks.saveMarkdown.mockReturnValueOnce(write.promise)

    const closing = editor.closeTabsTransactionally(['discard', 'save'])
    await vi.waitFor(() => expect(invokeMocks.saveMarkdown).toHaveBeenCalledOnce())
    editor.setMarkdownExternal('discard', 'new edit after choosing discard')
    write.resolve()

    await expect(closing).resolves.toBe(false)
    expect(editor.tabs.map(tab => tab.id)).toEqual(['discard', 'save'])
  })

  it('keeps ordinary single-tab discard behavior unchanged', async () => {
    const editor = useEditorStore()
    editor.tabs.push(dirtyFile('single', 'C:\\notes\\single.md'))
    confirm.mockRejectedValueOnce('cancel')

    await expect(editor.closeTab('single')).resolves.toBe(true)

    expect(editor.tabs).toHaveLength(0)
  })
})
