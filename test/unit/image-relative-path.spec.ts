import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  saveImageLocal: vi.fn(),
  uploadImageGithub: vi.fn(),
  uploadImagePicgo: vi.fn(),
  uploadImageScript: vi.fn(),
}))
const preferences = vi.hoisted(() => ({
  imageInsertAction: 'folder' as const,
  imageFolderPath: 'D:\\global-images',
  imagePreferRelativeDirectory: true,
  imageRelativeDirectoryName: 'assets',
  currentUploader: 'none' as const,
  githubToken: '',
  imageBed: { github: { owner: '', repo: '', branch: '' } },
  picgoPath: '',
  cliScript: '',
}))
const editor = vi.hoisted(() => ({
  currentFile: { pathname: 'C:\\notes\\guide.md' } as { pathname: string } | null,
}))
const notification = vi.hoisted(() => ({ pushToast: vi.fn() }))

vi.mock('@/services/tauri-invoke', () => ipc)
vi.mock('@/stores/preferences', () => ({ usePreferencesStore: () => preferences }))
vi.mock('@/stores/editor', () => ({ useEditorStore: () => editor }))
vi.mock('@/stores/notification', () => ({ useNotificationStore: () => notification }))

import { muyaImageAction } from '../../src/services/muya-image-action'
import { toPortableRelativeImageSrc } from '../../src/services/portable-image-path'

describe('portable relative image paths', () => {
  it('relativizes same-drive Windows paths case-insensitively', () => {
    expect(toPortableRelativeImageSrc(
      'c:\\Notes\\guide.md',
      'C:\\notes\\assets\\cover.png',
    )).toBe('./assets/cover.png')
  })

  it('rejects paths on different Windows drives', () => {
    expect(toPortableRelativeImageSrc(
      'C:\\notes\\guide.md',
      'D:\\images\\cover.png',
    )).toBeNull()
  })

  it('relativizes paths on the same UNC share', () => {
    expect(toPortableRelativeImageSrc(
      '\\\\server\\share\\docs\\guide.md',
      '\\\\SERVER\\SHARE\\assets\\cover.png',
    )).toBe('../assets/cover.png')
  })

  it('rejects paths on different UNC shares', () => {
    expect(toPortableRelativeImageSrc(
      '\\\\server\\share-a\\docs\\guide.md',
      '\\\\server\\share-b\\assets\\cover.png',
    )).toBeNull()
  })

  it('relativizes nested and parent POSIX paths', () => {
    expect(toPortableRelativeImageSrc(
      '/home/me/notes/guide.md',
      '/home/me/notes/assets/cover.png',
    )).toBe('./assets/cover.png')
    expect(toPortableRelativeImageSrc(
      '/home/me/notes/guides/guide.md',
      '/home/me/notes/shared/cover.png',
    )).toBe('../shared/cover.png')
  })

  it('URL-encodes spaces, fragments, literal percent signs, and Unicode', () => {
    expect(toPortableRelativeImageSrc(
      '/notes/guide.md',
      '/notes/assets/100% ready #\u56fe.png',
    )).toBe('./assets/100%25%20ready%20%23%E5%9B%BE.png')
  })

  it('does not double-encode existing percent escapes', () => {
    expect(toPortableRelativeImageSrc(
      '/notes/guide.md',
      '/notes/assets/already%20encoded.png',
    )).toBe('./assets/already%20encoded.png')
  })

  it('rejects missing documents and non-absolute inputs', () => {
    expect(toPortableRelativeImageSrc('', '/notes/assets/cover.png')).toBeNull()
    expect(toPortableRelativeImageSrc('guide.md', '/notes/assets/cover.png')).toBeNull()
    expect(toPortableRelativeImageSrc('/notes/guide.md', 'assets/cover.png')).toBeNull()
  })
})

describe('Muya folder image action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    preferences.imageFolderPath = 'D:\\global-images'
    preferences.imagePreferRelativeDirectory = true
    preferences.imageRelativeDirectoryName = 'assets'
    editor.currentFile = { pathname: 'C:\\notes\\guide.md' }
  })

  it('returns a relative Markdown URL in relative-directory mode', async () => {
    ipc.saveImageLocal.mockResolvedValue({ path: 'C:\\notes\\assets\\cover photo.png' })

    await expect(muyaImageAction('C:\\downloads\\cover.png', 'image-id'))
      .resolves.toBe('./assets/cover%20photo.png')
    expect(ipc.saveImageLocal).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: 'C:\\downloads\\cover.png',
      targetDir: 'C:\\notes/assets',
    }))
  })

  it('keeps the backend absolute path in ordinary folder mode', async () => {
    preferences.imagePreferRelativeDirectory = false
    ipc.saveImageLocal.mockResolvedValue({ path: 'D:\\global-images\\cover.png' })

    await expect(muyaImageAction('C:\\downloads\\cover.png', 'image-id'))
      .resolves.toBe('D:\\global-images\\cover.png')
    expect(notification.pushToast).not.toHaveBeenCalled()
  })

  it('warns and keeps the absolute path when roots are incompatible', async () => {
    ipc.saveImageLocal.mockResolvedValue({ path: 'D:\\images\\cover.png' })

    await expect(muyaImageAction('C:\\downloads\\cover.png', 'image-id'))
      .resolves.toBe('D:\\images\\cover.png')
    expect(notification.pushToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      title: 'Portable image link unavailable',
    }))
  })
})
