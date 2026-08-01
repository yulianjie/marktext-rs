import { convertFileSrc } from '@tauri-apps/api/core'

export type FileSrcConverter = (path: string) => string

const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/
const WINDOWS_DRIVE_ROOT = /^[a-zA-Z]:\/$/
const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/

function decodePathSegments(path: string): string {
  return path.split('/').map(segment => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  }).join('/')
}

function normalizeLocalPath(path: string): string {
  const forward = path.replace(/\\/g, '/')
  let prefix = ''
  let rest = forward
  let minimumSegments = 0

  if (WINDOWS_DRIVE_PATH.test(forward)) {
    prefix = forward.slice(0, 3)
    rest = forward.slice(3)
  } else if (forward.startsWith('//')) {
    prefix = '//'
    rest = forward.slice(2)
    // A UNC share is the filesystem root: //server/share/..
    // must not escape above the share name.
    minimumSegments = 2
  } else if (forward.startsWith('/')) {
    prefix = '/'
    rest = forward.slice(1)
  }

  const segments: string[] = []
  for (const segment of rest.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > minimumSegments) segments.pop()
    } else {
      segments.push(segment)
    }
  }

  if (WINDOWS_DRIVE_ROOT.test(prefix)) return prefix + segments.join('/')
  return prefix + segments.join('/')
}

function parentPath(path: string): string {
  const normalized = normalizeLocalPath(path)
  const index = normalized.lastIndexOf('/')
  if (index < 0) return ''
  if (index === 0) return '/'
  if (index === 2 && /^[a-zA-Z]:/.test(normalized)) return normalized.slice(0, 3)
  return normalized.slice(0, index)
}

function fileUrlToPath(src: string): string | null {
  try {
    const url = new URL(src)
    if (url.protocol !== 'file:') return null
    let pathname = decodeURIComponent(url.pathname)
    if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1)
    if (url.hostname) pathname = `//${url.hostname}${pathname}`
    return normalizeLocalPath(pathname)
  } catch {
    return null
  }
}

/**
 * Resolve a Markdown image source to an absolute device path.
 *
 * Returns `null` for web/data/blob/custom-protocol URLs and for relative
 * sources in untitled documents, so Muya can keep its existing URL handling.
 */
export function resolveLocalImagePath(src: string, documentPath = ''): string | null {
  const value = src.trim()
  if (!value) return null

  if (/^file:/i.test(value)) return fileUrlToPath(value)
  if (/^\/\//.test(value)) return null
  if (URL_SCHEME.test(value) && !WINDOWS_DRIVE_PATH.test(value)) return null

  // Query strings are meaningful for web URLs, but a local filesystem path
  // passed to convertFileSrc must not include them.
  const path = decodePathSegments(value.replace(/[?#].*$/, '').replace(/\\/g, '/'))
  if (WINDOWS_DRIVE_PATH.test(path) || path.startsWith('/') || path.startsWith('\\\\')) {
    return normalizeLocalPath(path)
  }
  if (!documentPath) return null

  return normalizeLocalPath(`${parentPath(documentPath)}/${path}`)
}

export function pathToFileUrl(path: string): string {
  const normalized = normalizeLocalPath(path)
  if (normalized.startsWith('//')) {
    const [hostname, ...segments] = normalized.slice(2).split('/')
    const url = new URL(`file://${hostname}/`)
    url.pathname = `/${segments.join('/')}`
    return url.href
  }

  const url = new URL('file:///')
  url.pathname = WINDOWS_DRIVE_PATH.test(normalized) ? `/${normalized}` : normalized
  return url.href
}

function defaultFileSrcConverter(path: string): string {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return convertFileSrc(path)
  }
  // Vite-only development and unit tests have no asset protocol. Retain a
  // standards-compliant file URL as the closest browser fallback.
  return pathToFileUrl(path)
}

/** Return a WebView-loadable URL for a local Markdown image, or `null` when
 * the source is not a resolvable local path. */
export function resolveLocalImageSrc(
  src: string,
  documentPath = '',
  converter: FileSrcConverter = defaultFileSrcConverter,
): string | null {
  const path = resolveLocalImagePath(src, documentPath)
  return path ? converter(path) : null
}
