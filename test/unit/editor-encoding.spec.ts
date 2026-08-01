import { describe, expect, it } from 'vitest'

import { requiresBomForReliableDetection } from '../../src/stores/editor'

describe('editor encoding safety', () => {
  it('adds a BOM for newly saved UTF-16 and UTF-32 documents', () => {
    expect(requiresBomForReliableDetection('UTF-16LE')).toBe(true)
    expect(requiresBomForReliableDetection('utf_16_be')).toBe(true)
    expect(requiresBomForReliableDetection('utf32le')).toBe(true)
    expect(requiresBomForReliableDetection('UTF-32 BE')).toBe(true)
  })

  it('does not force a BOM for UTF-8 or legacy encodings', () => {
    expect(requiresBomForReliableDetection('utf8')).toBe(false)
    expect(requiresBomForReliableDetection('windows-1252')).toBe(false)
  })
})
