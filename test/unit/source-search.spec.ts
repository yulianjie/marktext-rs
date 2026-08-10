import { describe, expect, it } from 'vitest'

import {
  findSourceMatches,
  firstSourceMatchAtOrAfter,
  stepSourceMatch,
} from '../../src/services/source-search'

describe('source mode search', () => {
  it('returns CodeMirror offsets for literal, case-insensitive matches', () => {
    expect(findSourceMatches('Alpha alpha alphabet', 'alpha')).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 11 },
      { from: 12, to: 17 },
    ])
  })

  it('supports whole-word, case-sensitive, and regular-expression options', () => {
    expect(findSourceMatches('Alpha alpha alphabet', 'alpha', {
      caseSensitive: true,
      wholeWord: true,
    })).toEqual([{ from: 6, to: 11 }])
    expect(findSourceMatches('h1 h22 h333', 'h\\d{2}\\b', { regex: true })).toEqual([
      { from: 3, to: 6 },
    ])
  })

  it('treats invalid and zero-width regexes as safe empty searches', () => {
    expect(findSourceMatches('text', '[', { regex: true })).toEqual([])
    expect(findSourceMatches('text', '^', { regex: true })).toEqual([])
  })

  it('selects from the cursor and wraps next/previous navigation', () => {
    const matches = findSourceMatches('one two one', 'one')
    expect(firstSourceMatchAtOrAfter(matches, 4)).toBe(1)
    expect(firstSourceMatchAtOrAfter(matches, 20)).toBe(0)
    expect(stepSourceMatch(matches, 1, 'next')).toBe(0)
    expect(stepSourceMatch(matches, 0, 'previous')).toBe(1)
  })
})
