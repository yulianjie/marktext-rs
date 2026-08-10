import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

import {
  pathIsSameOrDescendant,
  remapWatchedDocumentPath,
  useEditorStore,
} from '../../src/stores/editor'
import { getFileStateFromData, type DocumentState } from '../../src/stores/help'
import { usePreferencesStore } from '../../src/stores/preferences'

function openedFile(id: string, pathname: string, dirty = false): DocumentState {
  const tab = getFileStateFromData({
    markdown: dirty ? `dirty ${id}` : `clean ${id}`,
    pathname,
    filename: pathname.split(/[\\/]/).pop()!,
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
  })
  tab.id = id
  tab.isSaved = !dirty
  tab.lastSavedMarkdown = `baseline ${id}`
  tab.history = { stack: [{ id }], index: 0 }
  tab.historyMarkdown = tab.markdown
  return tab
}

function loaded(path: string, markdown: string) {
  return {
    path,
    markdown,
    encoding: 'UTF-8',
    lineEnding: 'lf',
    hadDecodeErrors: false,
    bom: false,
  }
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

describe('watcher path remapping', () => {
  it('handles Windows case/separator differences without prefix collisions', () => {
    expect(remapWatchedDocumentPath(
      'C:\\Notes\\Drafts',
      'D:/Archive/Drafts',
      'c:/notes/drafts/nested/plan.md',
    )).toBe('D:/Archive/Drafts/nested/plan.md')
    expect(remapWatchedDocumentPath(
      'C:\\notes\\drafts',
      'D:\\archive',
      'C:\\notes\\drafts-old\\plan.md',
    )).toBeNull()
  })

  it('keeps POSIX path boundaries case-sensitive', () => {
    expect(pathIsSameOrDescendant('/work/notes', '/work/notes/a.md')).toBe(true)
    expect(pathIsSameOrDescendant('/work/notes', '/work/Notes/a.md')).toBe(false)
  })
})

describe('external directory watcher events', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    invokeMocks.saveMarkdown.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('remaps clean and dirty child tabs while preserving their editor state', async () => {
    const editor = useEditorStore()
    const clean = openedFile('clean', 'C:\\Notes\\Drafts\\clean.md')
    const dirty = openedFile('dirty', 'C:\\Notes\\Drafts\\nested\\dirty.md', true)
    const prefix = openedFile('prefix', 'C:\\Notes\\Drafts-old\\outside.md')
    const cleanHistory = structuredClone(clean.history)
    const dirtyHistory = structuredClone(dirty.history)
    const cleanMarkdown = clean.markdown
    const dirtyMarkdown = dirty.markdown
    dirty.externalChange = {
      kind: 'modified',
      path: dirty.pathname,
      markdown: 'external version',
      encoding: { encoding: 'utf8', isBom: false },
      lineEnding: 'lf',
    }
    dirty.autoSaveBlocked = true
    editor.tabs.push(clean, dirty, prefix)

    await editor.handleFileWatchEvent({
      kind: 'renamed',
      from: 'c:/notes/drafts',
      to: 'D:\\Archive\\Drafts',
    })

    expect(clean.pathname).toBe('D:\\Archive\\Drafts\\clean.md')
    expect(dirty.pathname).toBe('D:\\Archive\\Drafts\\nested\\dirty.md')
    expect(clean.filename).toBe('clean.md')
    expect(dirty.filename).toBe('dirty.md')
    expect(clean.isSaved).toBe(true)
    expect(dirty.isSaved).toBe(false)
    expect(clean.markdown).toBe(cleanMarkdown)
    expect(dirty.markdown).toBe(dirtyMarkdown)
    expect(clean.history).toEqual(cleanHistory)
    expect(dirty.history).toEqual(dirtyHistory)
    expect(dirty.externalChange?.path).toBe('D:\\Archive\\Drafts\\nested\\dirty.md')
    expect(dirty.autoSaveBlocked).toBe(true)
    expect(prefix.pathname).toBe('C:\\Notes\\Drafts-old\\outside.md')
    expect(invokeMocks.readMarkdown).not.toHaveBeenCalled()
    expect(invokeMocks.saveMarkdown).not.toHaveBeenCalled()
  })

  it('detaches all missing descendants from one directory remove event', async () => {
    vi.useFakeTimers()
    const editor = useEditorStore()
    const prefs = usePreferencesStore()
    prefs.autoSave = true
    prefs.autoSaveDelay = 100
    const clean = openedFile('clean', 'C:\\Notes\\Drafts\\clean.md')
    const dirty = openedFile('dirty', 'C:\\Notes\\Drafts\\nested\\dirty.md', true)
    const prefix = openedFile('prefix', 'C:\\Notes\\Drafts-old\\outside.md')
    const dirtyMarkdown = dirty.markdown
    const dirtyHistory = structuredClone(dirty.history)
    editor.tabs.push(clean, dirty, prefix)
    editor.setMarkdownExternal(dirty.id, `${dirty.markdown} changed`)
    invokeMocks.readMarkdown.mockRejectedValue(new Error('not found'))

    await editor.handleFileWatchEvent({ kind: 'removed', path: 'c:/notes/drafts' })

    expect(clean.pathname).toBe('')
    expect(dirty.pathname).toBe('')
    expect(clean.isSaved).toBe(false)
    expect(dirty.isSaved).toBe(false)
    expect(dirty.markdown).toBe(`${dirtyMarkdown} changed`)
    expect(dirty.history).toEqual(dirtyHistory)
    expect(prefix.pathname).toBe('C:\\Notes\\Drafts-old\\outside.md')
    expect(invokeMocks.readMarkdown).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(500)
    expect(invokeMocks.saveMarkdown).not.toHaveBeenCalled()
  })

  it('keeps descendants attached when confirmation reads still succeed', async () => {
    const editor = useEditorStore()
    const child = openedFile('child', '/work/notes/drafts/child.md', true)
    editor.tabs.push(child)
    invokeMocks.readMarkdown.mockResolvedValue(loaded(child.pathname, child.markdown))

    await editor.handleFileWatchEvent({ kind: 'removed', path: '/work/notes/drafts' })

    expect(child.pathname).toBe('/work/notes/drafts/child.md')
    expect(child.isSaved).toBe(false)
    expect(notification).not.toHaveBeenCalled()
  })

  it('gates edits during a pending probe and resumes autosave after success', async () => {
    vi.useFakeTimers()
    const prefs = usePreferencesStore()
    prefs.autoSave = true
    prefs.autoSaveDelay = 50
    const editor = useEditorStore()
    const child = openedFile('child', '/work/notes/drafts/child.md')
    editor.tabs.push(child)
    const read = deferred<ReturnType<typeof loaded>>()
    invokeMocks.readMarkdown.mockReturnValueOnce(read.promise)

    const probing = editor.handleFileWatchEvent({ kind: 'removed', path: '/work/notes/drafts' })
    await vi.advanceTimersByTimeAsync(0)
    expect(invokeMocks.readMarkdown).toHaveBeenCalledOnce()

    editor.setMarkdownExternal(child.id, 'edited while removal probe is pending')
    await vi.advanceTimersByTimeAsync(500)
    expect(invokeMocks.saveMarkdown).not.toHaveBeenCalled()

    read.resolve(loaded(child.pathname, child.markdown))
    await probing
    await vi.advanceTimersByTimeAsync(50)

    expect(invokeMocks.saveMarkdown).toHaveBeenCalledOnce()
    expect(invokeMocks.saveMarkdown).toHaveBeenCalledWith(
      '/work/notes/drafts/child.md',
      'edited while removal probe is pending',
      expect.any(Object),
    )
  })

  it('never autosaves the old path after a pending probe confirms removal', async () => {
    vi.useFakeTimers()
    const prefs = usePreferencesStore()
    prefs.autoSave = true
    prefs.autoSaveDelay = 50
    const editor = useEditorStore()
    const child = openedFile('child', '/work/notes/drafts/child.md')
    editor.tabs.push(child)
    const read = deferred<ReturnType<typeof loaded>>()
    invokeMocks.readMarkdown.mockReturnValueOnce(read.promise)

    const probing = editor.handleFileWatchEvent({ kind: 'removed', path: '/work/notes/drafts' })
    await vi.advanceTimersByTimeAsync(0)
    editor.setMarkdownExternal(child.id, 'local draft while removal is pending')
    await vi.advanceTimersByTimeAsync(500)
    expect(invokeMocks.saveMarkdown).not.toHaveBeenCalled()

    read.reject(new Error('not found'))
    await probing
    expect(child.pathname).toBe('')
    await vi.advanceTimersByTimeAsync(500)
    expect(invokeMocks.saveMarkdown).not.toHaveBeenCalled()
  })

  it('clears the probe gate and resumes autosave on a renamed path', async () => {
    vi.useFakeTimers()
    const prefs = usePreferencesStore()
    prefs.autoSave = true
    prefs.autoSaveDelay = 50
    const editor = useEditorStore()
    const child = openedFile('child', 'C:\\notes\\drafts\\child.md')
    editor.tabs.push(child)
    const read = deferred<ReturnType<typeof loaded>>()
    invokeMocks.readMarkdown.mockReturnValueOnce(read.promise)

    const probing = editor.handleFileWatchEvent({ kind: 'removed', path: 'C:\\notes\\drafts' })
    await vi.advanceTimersByTimeAsync(0)
    editor.setMarkdownExternal(child.id, 'edit before rename')
    await editor.handleFileWatchEvent({
      kind: 'renamed',
      from: 'C:\\notes\\drafts',
      to: 'D:\\archive\\drafts',
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(invokeMocks.saveMarkdown).not.toHaveBeenCalled()

    read.reject(new Error('old path is gone'))
    await probing
    await vi.advanceTimersByTimeAsync(50)

    expect(child.pathname).toBe('D:\\archive\\drafts\\child.md')
    expect(invokeMocks.saveMarkdown).toHaveBeenCalledWith(
      'D:\\archive\\drafts\\child.md',
      'edit before rename',
      expect.any(Object),
    )
  })

  it('keeps autosave gated until overlapping removal probes both finish', async () => {
    vi.useFakeTimers()
    const prefs = usePreferencesStore()
    prefs.autoSave = true
    prefs.autoSaveDelay = 50
    const editor = useEditorStore()
    const child = openedFile('child', '/work/notes/drafts/child.md')
    editor.tabs.push(child)
    const firstRead = deferred<ReturnType<typeof loaded>>()
    const secondRead = deferred<ReturnType<typeof loaded>>()
    invokeMocks.readMarkdown
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise)

    const firstProbe = editor.handleFileWatchEvent({ kind: 'removed', path: '/work/notes/drafts' })
    await vi.advanceTimersByTimeAsync(0)
    const secondProbe = editor.handleFileWatchEvent({ kind: 'removed', path: '/work/notes/drafts' })
    await vi.advanceTimersByTimeAsync(0)
    expect(invokeMocks.readMarkdown).toHaveBeenCalledOnce()

    firstRead.resolve(loaded(child.pathname, child.markdown))
    await firstProbe
    await vi.advanceTimersByTimeAsync(0)
    expect(invokeMocks.readMarkdown).toHaveBeenCalledTimes(2)

    editor.setMarkdownExternal(child.id, 'edit while the second probe is pending')
    await vi.advanceTimersByTimeAsync(500)
    expect(invokeMocks.saveMarkdown).not.toHaveBeenCalled()

    secondRead.reject(new Error('not found'))
    await secondProbe
    expect(child.pathname).toBe('')
    await vi.advanceTimersByTimeAsync(500)
    expect(invokeMocks.saveMarkdown).not.toHaveBeenCalled()
  })
})
