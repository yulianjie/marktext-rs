import { describe, expect, it } from 'vitest'

import { pathIsInsideRoot } from '../../src/stores/project'

describe('project watcher path boundary', () => {
  it('accepts renamed endpoints inside the root without prefix collisions', () => {
    expect(pathIsInsideRoot('C:\\notes', 'C:\\notes\\draft.md')).toBe(true)
    expect(pathIsInsideRoot('C:\\notes', 'c:/notes/renamed.md')).toBe(true)
    expect(pathIsInsideRoot('C:\\notes', 'C:\\notes-old\\draft.md')).toBe(false)
  })

  it('keeps POSIX path comparisons case-sensitive', () => {
    expect(pathIsInsideRoot('/work/notes', '/work/notes/a.md')).toBe(true)
    expect(pathIsInsideRoot('/work/notes', '/work/Notes/a.md')).toBe(false)
  })
})
