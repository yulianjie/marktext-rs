import { describe, expect, it } from 'vitest'

import { parseSearchMaxFileSize } from '../../src/services/search-preferences'

describe('search preference parsing', () => {
  it('converts byte and binary suffix values', () => {
    expect(parseSearchMaxFileSize('42')).toBe(42)
    expect(parseSearchMaxFileSize('2K')).toBe(2 * 1024)
    expect(parseSearchMaxFileSize('3m')).toBe(3 * 1024 ** 2)
    expect(parseSearchMaxFileSize('1G')).toBe(1024 ** 3)
  })

  it('does not send malformed or unsafe values to Rust', () => {
    expect(parseSearchMaxFileSize('')).toBeUndefined()
    expect(parseSearchMaxFileSize('10MB')).toBeUndefined()
    expect(parseSearchMaxFileSize('-1')).toBeUndefined()
    expect(parseSearchMaxFileSize('999999999999999999999G')).toBeUndefined()
  })
})
