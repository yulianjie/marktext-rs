import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const ipc = vi.hoisted(() => ({
  listWorkspaceDirectory: vi.fn(),
  watchFolder: vi.fn(),
  unwatchFolder: vi.fn(),
  createWorkspaceEntry: vi.fn(),
  renameWorkspaceEntry: vi.fn(),
  copyWorkspaceEntry: vi.fn(),
  moveWorkspaceEntry: vi.fn(),
  trashWorkspaceEntry: vi.fn(),
}))
const bridge = vi.hoisted(() => ({ listenTyped: vi.fn(async () => () => {}) }))
const preferences = vi.hoisted(() => ({
  fileSortBy: 'title' as const,
  pushRecentFolder: vi.fn(async () => {}),
}))
const editor = vi.hoisted(() => ({ tabs: [] as Array<{ pathname: string; filename: string }> }))
const notification = vi.hoisted(() => ({ pushToast: vi.fn() }))

vi.mock('@/services/tauri-invoke', () => ipc)
vi.mock('@/services/tauri-bridge', () => bridge)
vi.mock('@/stores/preferences', () => ({ usePreferencesStore: () => preferences }))
vi.mock('@/stores/editor', () => ({ useEditorStore: () => editor }))
vi.mock('@/stores/notification', () => ({ useNotificationStore: () => notification }))
vi.mock('@/i18n', () => ({ t: (key: string) => key }))

import { collectTreeFilterMatches, useProjectStore } from '../../src/stores/project'
import type { DirEntry } from '../../src/services/tauri-invoke'

function directory(path: string): DirEntry {
  return {
    name: path.split(/[\\/]/).pop()!,
    path,
    isDir: true,
    isMarkdown: false,
    size: 0,
    modifiedMs: 1,
    createdMs: 1,
  }
}

function file(path: string): DirEntry {
  return {
    name: path.split(/[\\/]/).pop()!,
    path,
    isDir: false,
    isMarkdown: true,
    size: 1,
    modifiedMs: 1,
    createdMs: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('lazy project tree', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ipc.watchFolder.mockImplementation(async (path: string) => path)
    ipc.unwatchFolder.mockResolvedValue(undefined)
    ipc.listWorkspaceDirectory.mockResolvedValue([])
  })

  it('opens a workspace by listing only the root level', async () => {
    ipc.listWorkspaceDirectory.mockImplementation(async (_root: string, path: string) => {
      if (path === 'C:\\notes') return [directory('C:\\notes\\nested')]
      throw new Error(`unexpected recursive read: ${path}`)
    })
    const project = useProjectStore()

    await project.openRoot('C:\\notes')

    expect(ipc.listWorkspaceDirectory).toHaveBeenCalledTimes(1)
    expect(ipc.listWorkspaceDirectory).toHaveBeenCalledWith('C:\\notes', 'C:\\notes')
    expect(project.projectTree?.loaded).toBe(true)
    expect(project.projectTree?.folders[0].loaded).toBe(false)
  })

  it('loads a folder on demand and deduplicates concurrent expand requests', async () => {
    const nestedListing = deferred<DirEntry[]>()
    ipc.listWorkspaceDirectory.mockImplementation((_root: string, path: string) => {
      if (path === 'C:\\notes') return Promise.resolve([directory('C:\\notes\\nested')])
      if (path === 'C:\\notes\\nested') return nestedListing.promise
      return Promise.resolve([])
    })
    const project = useProjectStore()
    await project.openRoot('C:\\notes')
    const nested = project.projectTree!.folders[0]

    const first = project.toggleFolder(nested)
    const second = project.ensureFolderLoaded(nested)
    expect(nested.loading).toBe(true)
    expect(ipc.listWorkspaceDirectory.mock.calls.filter(call => call[1] === nested.pathname)).toHaveLength(1)

    nestedListing.resolve([file('C:\\notes\\nested\\draft.md')])
    await Promise.all([first, second])
    expect(nested.loaded).toBe(true)
    expect(nested.isCollapsed).toBe(false)
    expect(nested.files.map(entry => entry.name)).toEqual(['draft.md'])
  })

  it('refreshes the root and loaded descendants without reading collapsed placeholders', async () => {
    ipc.listWorkspaceDirectory.mockImplementation(async (_root: string, path: string) => {
      if (path === 'C:\\notes') {
        return [directory('C:\\notes\\loaded'), directory('C:\\notes\\unopened')]
      }
      if (path === 'C:\\notes\\loaded') return [file('C:\\notes\\loaded\\one.md')]
      throw new Error(`unopened folder was read: ${path}`)
    })
    const project = useProjectStore()
    await project.openRoot('C:\\notes')
    await project.ensureFolderLoaded(project.projectTree!.folders[0])
    ipc.listWorkspaceDirectory.mockClear()

    await project.refreshTree()

    const refreshedPaths = ipc.listWorkspaceDirectory.mock.calls.map(call => call[1])
    expect(refreshedPaths).toEqual(expect.arrayContaining(['C:\\notes', 'C:\\notes\\loaded']))
    expect(refreshedPaths).not.toContain('C:\\notes\\unopened')
    expect(project.projectTree!.folders.find(folder => folder.name === 'loaded')?.loaded).toBe(true)
  })

  it('recursively loads unloaded descendants so filtering cannot omit a match', async () => {
    ipc.listWorkspaceDirectory.mockImplementation(async (_root: string, path: string) => {
      if (path === 'C:\\notes') return [directory('C:\\notes\\one')]
      if (path === 'C:\\notes\\one') return [directory('C:\\notes\\one\\two')]
      if (path === 'C:\\notes\\one\\two') return [file('C:\\notes\\one\\two\\needle.md')]
      return []
    })
    const project = useProjectStore()
    await project.openRoot('C:\\notes')

    await expect(project.loadTreeForFilter('needle')).resolves.toBe(true)

    expect(ipc.listWorkspaceDirectory.mock.calls.map(call => call[1])).toEqual([
      'C:\\notes',
      'C:\\notes\\one',
      'C:\\notes\\one\\two',
    ])
    const matches = collectTreeFilterMatches(project.projectTree!, 'needle')
    expect(matches).toEqual(new Set([
      'C:\\notes\\one',
      'C:\\notes\\one\\two',
      'C:\\notes\\one\\two\\needle.md',
    ]))
  })

  it('prevents a cancelled filter traversal from publishing stale loading state', async () => {
    const listing = deferred<DirEntry[]>()
    ipc.listWorkspaceDirectory.mockImplementation((_root: string, path: string) => {
      if (path === 'C:\\notes') return Promise.resolve([directory('C:\\notes\\slow')])
      return listing.promise
    })
    const project = useProjectStore()
    await project.openRoot('C:\\notes')

    const stale = project.loadTreeForFilter('old query')
    await Promise.resolve()
    await project.loadTreeForFilter('')
    listing.resolve([file('C:\\notes\\slow\\old-query.md')])

    await expect(stale).resolves.toBe(false)
    expect(project.filterLoading).toBe(false)
    expect(project.filterError).toBeNull()
    expect(project.activeFilterQuery).toBe('')
  })

  it('keeps a failed folder retryable without duplicating concurrent requests', async () => {
    let attempts = 0
    ipc.listWorkspaceDirectory.mockImplementation(async (_root: string, path: string) => {
      if (path === 'C:\\notes') return [directory('C:\\notes\\flaky')]
      attempts += 1
      if (attempts === 1) throw new Error('temporary read failure')
      return [file('C:\\notes\\flaky\\recovered.md')]
    })
    const project = useProjectStore()
    await project.openRoot('C:\\notes')
    const flaky = project.projectTree!.folders[0]

    await project.toggleFolder(flaky)
    expect(flaky.loaded).toBe(false)
    expect(flaky.loadError).toContain('temporary read failure')

    await project.retryFolder(flaky)
    expect(attempts).toBe(2)
    expect(flaky.loaded).toBe(true)
    expect(flaky.loadError).toBeNull()
    expect(flaky.files[0].name).toBe('recovered.md')
  })
})
