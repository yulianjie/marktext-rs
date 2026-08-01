import { describe, expect, it, vi } from 'vitest'

import {
  pathToFileUrl,
  resolveLocalImagePath,
  resolveLocalImageSrc,
} from '../../src/services/local-image-src'

describe('local Markdown image sources', () => {
  it('resolves a relative image beside a Windows Markdown document', () => {
    expect(resolveLocalImagePath(
      './images/screenshot.png',
      'C:\\notes\\guide\\README.md',
    )).toBe('C:/notes/guide/images/screenshot.png')
  })

  it('keeps cache keys distinct for equal relative paths in different tabs', () => {
    const convert = vi.fn(path => `asset://localhost/${path}`)

    expect(resolveLocalImageSrc('images/a.png', 'C:\\one\\a.md', convert))
      .toBe('asset://localhost/C:/one/images/a.png')
    expect(resolveLocalImageSrc('images/a.png', 'D:\\two\\b.md', convert))
      .toBe('asset://localhost/D:/two/images/a.png')
  })

  it('passes absolute and file URL paths to the asset converter', () => {
    const convert = vi.fn(path => `asset:${path}`)

    expect(resolveLocalImageSrc('C:\\图片\\cover photo.png', '', convert))
      .toBe('asset:C:/图片/cover photo.png')
    expect(resolveLocalImageSrc('file:///C:/notes/cover%20photo.png', '', convert))
      .toBe('asset:C:/notes/cover photo.png')
  })

  it('normalizes parent segments without escaping a UNC share', () => {
    expect(resolveLocalImagePath(
      '../../../cover.png',
      '\\\\server\\share\\docs\\guide.md',
    )).toBe('//server/share/cover.png')
  })

  it('leaves network, data, and untitled relative sources to Muya', () => {
    expect(resolveLocalImagePath('https://example.com/a.png', 'C:\\notes\\a.md')).toBeNull()
    expect(resolveLocalImagePath('data:image/png;base64,AAAA', 'C:\\notes\\a.md')).toBeNull()
    expect(resolveLocalImagePath('images/a.png', '')).toBeNull()
  })

  it('creates an encoded standards-compliant browser fallback URL', () => {
    expect(pathToFileUrl('C:/图片/cover photo.png'))
      .toBe('file:///C:/%E5%9B%BE%E7%89%87/cover%20photo.png')
  })
})
