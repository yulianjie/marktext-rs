import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getBlankFileState, getFileStateFromData, type DocumentState } from '../../src/stores/help'
import {
  assertValidEditorSession,
  buildEditorSessionSnapshot,
  createEditorSessionRestorePlan,
  createEditorSessionWriter,
  EDITOR_SESSION_VERSION,
  MAX_EDITOR_SESSION_DRAFT_BYTES,
  persistCleanEditorSession,
  runBoundedAsyncTasks,
  type EditorSession,
  type SessionDiskProbe,
} from '../../src/services/editor-session'
import {
  clearEditorSession,
  getEditorSession,
  setEditorSession,
} from '../../src/services/tauri-invoke'

function cleanTab(path: string, id: string): DocumentState {
  const tab = getFileStateFromData({
    markdown: `disk:${id}`,
    pathname: path,
    filename: path.split(/[\\/]/).pop()!,
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
  })
  tab.id = id
  tab.cursor = { anchor: id.length }
  return tab
}

function dirtyTab(path = ''): DocumentState {
  const tab = path
    ? cleanTab(path, 'dirty')
    : getBlankFileState([], 'utf8', 'crlf')
  tab.id = 'dirty'
  tab.filename = path ? 'dirty.md' : 'Untitled-7'
  tab.markdown = 'local draft'
  tab.lastSavedMarkdown = path ? 'disk baseline' : ''
  tab.isSaved = false
  tab.sourceMode = true
  tab.sourceSelection = { ranges: [{ anchor: 4, head: 4 }], main: 0 }
  return tab
}

function mixedSession(): EditorSession {
  return buildEditorSessionSnapshot({
    tabs: [cleanTab('C:\\notes\\one.md', 'one'), dirtyTab('C:\\notes\\two.md'), cleanTab('C:\\notes\\three.md', 'three')],
    currentFileId: 'dirty',
    workspacePath: 'C:\\notes',
    timestamp: 42,
  })
}

describe('editor session snapshots', () => {
  beforeEach(async () => {
    await clearEditorSession()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves tab order, active tab, workspace and only copies dirty contents', () => {
    const session = mixedSession()

    expect(session.version).toBe(EDITOR_SESSION_VERSION)
    expect(session.workspacePath).toBe('C:\\notes')
    expect(session.activeTabIndex).toBe(1)
    expect(session.tabs.map(tab => tab.dirty)).toEqual([false, true, false])
    expect(session.tabs[0]).toEqual(expect.objectContaining({
      dirty: false,
      path: 'C:\\notes\\one.md',
    }))
    expect(session.tabs[0]).not.toHaveProperty('markdown')
    expect(session.tabs[1]).toEqual(expect.objectContaining({
      dirty: true,
      markdown: 'local draft',
      lastSavedMarkdown: 'disk baseline',
      trimTrailingNewline: 3,
      sourceMode: true,
    }))
  })

  it('excludes discarded dirty tabs and recalculates the active index', () => {
    const clean = cleanTab('C:\\notes\\one.md', 'one')
    const dirty = dirtyTab()
    const session = buildEditorSessionSnapshot({
      tabs: [dirty, clean],
      currentFileId: clean.id,
      cleanShutdown: true,
      excludeDirty: true,
      timestamp: 7,
    })

    expect(session.cleanShutdown).toBe(true)
    expect(session.tabs).toHaveLength(1)
    expect(session.tabs[0]).toMatchObject({ dirty: false, path: clean.pathname })
    expect(session.activeTabIndex).toBe(0)
  })

  it('omits the rebuildable blank placeholder from a clean shutdown snapshot', async () => {
    const blank = getBlankFileState([], 'utf8', 'lf')
    const session = buildEditorSessionSnapshot({
      tabs: [blank],
      currentFileId: blank.id,
      cleanShutdown: true,
      timestamp: 8,
    })

    expect(session.tabs).toEqual([])
    expect(session.activeTabIndex).toBeUndefined()
    expect(() => assertValidEditorSession(session)).not.toThrow()
    await expect(setEditorSession(session)).resolves.toBeUndefined()
    expect(await getEditorSession()).toEqual(session)
  })

  it('recalculates the active index after filtering a blank placeholder', () => {
    const blank = getBlankFileState([], 'utf8', 'lf')
    const clean = cleanTab('C:\\notes\\one.md', 'one')
    const session = buildEditorSessionSnapshot({
      tabs: [blank, clean],
      currentFileId: clean.id,
      cleanShutdown: true,
      timestamp: 9,
    })

    expect(session.tabs).toEqual([
      expect.objectContaining({ dirty: false, path: clean.pathname }),
    ])
    expect(session.activeTabIndex).toBe(0)
  })

  it('classifies unchanged, changed, missing and untitled drafts without writes', () => {
    const session = mixedSession()
    session.tabs.push({
      dirty: true,
      filename: 'Untitled-9',
      markdown: 'new',
      lastSavedMarkdown: '',
      encoding: 'utf8',
      bom: false,
      lineEnding: 'lf',
      sourceMode: false,
    })
    const probes = new Map<string, SessionDiskProbe>([
      ['C:\\notes\\one.md', { status: 'ok', markdown: 'disk:one' }],
      ['C:\\notes\\two.md', { status: 'ok', markdown: 'disk baseline' }],
      ['C:\\notes\\three.md', { status: 'missing' }],
    ])

    expect(createEditorSessionRestorePlan(session, probes, true).map(item => item.action)).toEqual([
      'use-disk',
      'restore-draft',
      'skip',
      'restore-detached',
    ])

    probes.set('C:\\notes\\two.md', { status: 'ok', markdown: 'newer disk' })
    expect(createEditorSessionRestorePlan(session, probes, true)[1].action).toBe('ask-conflict')

    probes.set('C:\\notes\\two.md', { status: 'error', message: 'Operation timed out' })
    expect(createEditorSessionRestorePlan(session, probes, true)[1].action).toBe('restore-detached')
  })

  it('accepts old version-1 dirty tabs without a policy and compares disk using the fallback', () => {
    const session = mixedSession()
    const dirty = session.tabs[1]
    if (!dirty.dirty) throw new Error('expected dirty fixture')
    dirty.markdown = 'local\n'
    dirty.lastSavedMarkdown = 'disk\n'
    delete dirty.trimTrailingNewline

    expect(() => assertValidEditorSession(session)).not.toThrow()
    const probes = new Map<string, SessionDiskProbe>([
      [dirty.path!, { status: 'ok', markdown: 'disk\r\n' }],
    ])
    expect(createEditorSessionRestorePlan(session, probes, true, 1)[1].action).toBe('restore-draft')
  })

  it('rejects an out-of-range persisted trailing-newline policy', () => {
    const session = mixedSession()
    const dirty = session.tabs[1]
    if (!dirty.dirty) throw new Error('expected dirty fixture')
    ;(dirty as unknown as Record<string, unknown>).trimTrailingNewline = 4
    expect(() => assertValidEditorSession(session)).toThrow(/trimTrailingNewline is invalid/)
  })

  it('debounces keystrokes and flushes ordered snapshots immediately', async () => {
    vi.useFakeTimers()
    let revision = 0
    const writes: number[] = []
    const writer = createEditorSessionWriter({
      delay: 1000,
      snapshot: flags => ({
        version: 1,
        cleanShutdown: flags.cleanShutdown,
        timestamp: revision,
        tabs: [],
      }),
      write: async session => { writes.push(session.timestamp) },
    })

    revision = 1
    writer.schedule()
    revision = 2
    writer.schedule()
    await vi.advanceTimersByTimeAsync(999)
    expect(writes).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(writes).toEqual([2])

    revision = 3
    await writer.flush()
    expect(writes).toEqual([2, 3])
    writer.dispose()
  })

  it('bounds concurrent probes while preserving result order', async () => {
    let active = 0
    let maxActive = 0
    const results = await runBoundedAsyncTasks(
      [0, 1, 2, 3, 4, 5],
      async value => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise(resolve => setTimeout(resolve, (5 - value) * 2))
        active -= 1
        return value * 10
      },
      { concurrency: 2, timeoutMs: 1000 },
    )

    expect(maxActive).toBe(2)
    expect(results).toEqual([0, 10, 20, 30, 40, 50].map(value => ({
      status: 'fulfilled',
      value,
    })))
  })

  it('settles timed-out and explicitly aborted probes without waiting for their IPC', async () => {
    vi.useFakeTimers()
    let started = 0
    const timeoutRun = runBoundedAsyncTasks(
      ['offline-1', 'offline-2', 'offline-3', 'offline-4'],
      async () => {
        started += 1
        return await new Promise<string>(() => undefined)
      },
      { concurrency: 2, timeoutMs: 25 },
    )
    await vi.advanceTimersByTimeAsync(25)
    const timedOut = await timeoutRun
    expect(started).toBe(2)
    expect(timedOut).toHaveLength(4)
    for (const result of timedOut) {
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') {
        // Includes tasks that never started after both worker slots retired.
        expect((result.reason as Error).name).toBe('TimeoutError')
      }
    }

    const controller = new AbortController()
    const abortRun = runBoundedAsyncTasks(
      ['one', 'two'],
      async () => await new Promise<string>(() => undefined),
      { concurrency: 1, timeoutMs: 60_000, signal: controller.signal },
    )
    await Promise.resolve()
    controller.abort()
    const aborted = await abortRun
    expect(aborted).toHaveLength(2)
    for (const result of aborted) {
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') expect((result.reason as Error).name).toBe('AbortError')
    }
  })

  it('replaces a stale crash snapshot even when close beats writer installation', async () => {
    let persisted = mixedSession()
    expect(persisted.tabs.some(tab => tab.dirty)).toBe(true)

    await persistCleanEditorSession({
      writer: null,
      excludeDirty: true,
      snapshot: flags => buildEditorSessionSnapshot({
        tabs: [],
        currentFileId: null,
        cleanShutdown: flags.cleanShutdown,
        excludeDirty: flags.excludeDirty,
        timestamp: 99,
      }),
      write: async session => { persisted = session },
    })

    expect(persisted.cleanShutdown).toBe(true)
    expect(persisted.tabs).toEqual([])
  })

  it('rejects old versions and oversized drafts in browser fallback too', async () => {
    const old = { ...mixedSession(), version: 0 }
    expect(() => assertValidEditorSession(old)).toThrow(/unsupported editor session version/)
    expect(() => setEditorSession(old as EditorSession)).toThrow(/unsupported editor session version/)

    const oversized = dirtyTab()
    oversized.markdown = 'x'.repeat(MAX_EDITOR_SESSION_DRAFT_BYTES + 1)
    expect(() => buildEditorSessionSnapshot({
      tabs: [oversized],
      currentFileId: oversized.id,
    })).not.toThrow()
    const snapshot = buildEditorSessionSnapshot({ tabs: [oversized], currentFileId: oversized.id })
    expect(() => setEditorSession(snapshot)).toThrow(/draft is too large/)

    await setEditorSession(mixedSession())
    expect(await getEditorSession()).toEqual(mixedSession())
    await clearEditorSession()
    expect(await getEditorSession()).toBeNull()
  })
})
