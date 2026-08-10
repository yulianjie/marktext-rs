import { describe, expect, it, vi } from 'vitest'

import {
  closeTabsBeforeDelete,
  remapPathWithinRoot,
  treeNodeMatchesFilter,
} from '../../src/stores/project'
import type { TreeFolder } from '../../src/stores/treeCtrl'

function folderTree(): TreeFolder {
  return {
    id: 'root',
    name: 'notes',
    pathname: 'C:\\notes',
    isCollapsed: false,
    loaded: true,
    loading: false,
    loadError: null,
    isFile: false,
    isDirectory: true,
    isMarkdown: false,
    folders: [{
      id: 'drafts',
      name: 'drafts',
      pathname: 'C:\\notes\\drafts',
      isCollapsed: true,
      loaded: true,
      loading: false,
      loadError: null,
      isFile: false,
      isDirectory: true,
      isMarkdown: false,
      folders: [],
      files: [{
        id: 'release',
        name: 'release-notes.md',
        pathname: 'C:\\notes\\drafts\\release-notes.md',
        isFile: true,
        isDirectory: false,
        isMarkdown: true,
      }],
    }],
    files: [],
  }
}

describe('project entry path updates', () => {
  it('remaps open descendants after a folder rename', () => {
    expect(remapPathWithinRoot(
      'C:\\notes\\drafts',
      'C:\\notes\\archive',
      'c:/notes/drafts/2026/plan.md',
    )).toBe('C:\\notes\\archive\\2026\\plan.md')
    expect(remapPathWithinRoot(
      'C:\\notes\\drafts',
      'C:\\notes\\archive',
      'C:\\notes\\drafts-old\\plan.md',
    )).toBeNull()
  })

  it('stops deletion when an affected tab cancels close', async () => {
    const closeTabs = vi.fn(async (ids: readonly string[]) => !ids.includes('cancelled'))
    const result = await closeTabsBeforeDelete([
      { id: 'saved', pathname: 'C:\\notes\\drafts\\saved.md' },
      { id: 'cancelled', pathname: 'C:\\notes\\drafts\\dirty.md' },
      { id: 'outside', pathname: 'C:\\notes-old\\other.md' },
    ], 'C:\\notes\\drafts', true, closeTabs)

    expect(result).toBe(false)
    expect(closeTabs).toHaveBeenCalledOnce()
    expect(closeTabs).toHaveBeenCalledWith(['saved', 'cancelled'])
  })

  it('does not close a similarly prefixed file when deleting one file', async () => {
    const closeTabs = vi.fn(async () => true)
    await closeTabsBeforeDelete([
      { id: 'target', pathname: 'C:\\notes\\draft.md' },
      { id: 'prefix', pathname: 'C:\\notes\\draft.md.bak' },
    ], 'C:\\notes\\draft.md', false, closeTabs)

    expect(closeTabs).toHaveBeenCalledTimes(1)
    expect(closeTabs).toHaveBeenCalledWith(['target'])
  })
})

describe('project filename filtering', () => {
  it('keeps parent folders visible for a matching descendant', () => {
    const tree = folderTree()
    expect(treeNodeMatchesFilter(tree.folders[0], 'release')).toBe(true)
    expect(treeNodeMatchesFilter(tree.folders[0], 'missing')).toBe(false)
    expect(treeNodeMatchesFilter(tree.folders[0].files[0], 'NOTES')).toBe(true)
  })
})
