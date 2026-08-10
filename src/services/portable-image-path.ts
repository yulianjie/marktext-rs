type AbsolutePathKind = 'drive' | 'unc' | 'posix'

interface ParsedAbsolutePath {
  kind: AbsolutePathKind
  rootKey: string
  segments: string[]
  caseInsensitive: boolean
}

function normalizeAbsoluteSegments(rawSegments: string[]): string[] | null {
  const segments: string[] = []
  for (const segment of rawSegments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments
}

/**
 * Parse the three absolute path forms returned by Tauri on supported hosts.
 * Device paths are deliberately rejected: turning `\\?\...` or `\\.\...`
 * into a Markdown URL would change their semantics.
 */
function parseAbsolutePath(path: string): ParsedAbsolutePath | null {
  if (!path || path.includes('\0')) return null

  const portable = path.replace(/\\/g, '/')
  if (/^\/\/[?.]\//.test(portable)) return null

  const drive = /^([A-Za-z]):\/(.*)$/.exec(portable)
  if (drive) {
    const segments = normalizeAbsoluteSegments(drive[2].split('/'))
    if (!segments) return null
    return {
      kind: 'drive',
      rootKey: drive[1].toUpperCase(),
      segments,
      caseInsensitive: true,
    }
  }

  if (/^\/\/[^/]/.test(portable)) {
    const rawSegments = portable.slice(2).split('/')
    const server = rawSegments.shift()
    const share = rawSegments.shift()
    if (!server || !share || server === '.' || server === '..' || share === '.' || share === '..') {
      return null
    }
    const segments = normalizeAbsoluteSegments(rawSegments)
    if (!segments) return null
    return {
      kind: 'unc',
      rootKey: `${server.toLocaleLowerCase('en-US')}/${share.toLocaleLowerCase('en-US')}`,
      segments,
      caseInsensitive: true,
    }
  }

  if (portable.startsWith('/')) {
    const segments = normalizeAbsoluteSegments(portable.split('/'))
    if (!segments) return null
    return {
      kind: 'posix',
      rootKey: '/',
      segments,
      caseInsensitive: false,
    }
  }

  return null
}

function equalPathSegment(left: string, right: string, caseInsensitive: boolean): boolean {
  if (!caseInsensitive) return left === right
  return left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
}

function encodeUrlPathSegment(segment: string): string | null {
  try {
    // Preserve existing URL escapes while encoding literal percent signs and
    // Markdown/URL-sensitive characters. Splitting also prevents `%2520` when
    // a path returned by the backend already contains an encoded component.
    return segment
      .split(/(%[0-9A-Fa-f]{2})/g)
      .map(part => /^%[0-9A-Fa-f]{2}$/.test(part) ? part : encodeURIComponent(part))
      .join('')
  } catch {
    // encodeURIComponent rejects malformed lone UTF-16 surrogates. Falling
    // back to an absolute path is safer than emitting a corrupt Markdown URL.
    return null
  }
}

/**
 * Convert an absolute path returned by `cmd_save_image_local` into a portable
 * Markdown URL relative to the Markdown document.
 *
 * Descendants and same-directory files use an explicit `./` prefix; paths in
 * a parent directory retain their leading `../`. Different Windows drives,
 * different UNC shares, relative inputs, and malformed paths return `null` so
 * the caller can keep the backend's absolute result instead.
 *
 * This is intentionally lexical. The Rust command returns
 * `target_dir.join(filename)` rather than a canonical path, and this helper
 * neither widens its filesystem permissions nor attempts to resolve symlinks.
 */
export function toPortableRelativeImageSrc(
  documentPath: string,
  savedPath: string,
): string | null {
  const document = parseAbsolutePath(documentPath)
  const saved = parseAbsolutePath(savedPath)
  if (!document || !saved || document.segments.length === 0 || saved.segments.length === 0) {
    return null
  }
  if (document.kind !== saved.kind || document.rootKey !== saved.rootKey) return null

  const documentDir = document.segments.slice(0, -1)
  let commonLength = 0
  while (
    commonLength < documentDir.length
    && commonLength < saved.segments.length
    && equalPathSegment(
      documentDir[commonLength],
      saved.segments[commonLength],
      document.caseInsensitive,
    )
  ) {
    commonLength += 1
  }

  const relativeSegments = [
    ...Array.from({ length: documentDir.length - commonLength }, () => '..'),
    ...saved.segments.slice(commonLength),
  ]
  if (relativeSegments.length === 0) return null

  const encoded: string[] = []
  for (const segment of relativeSegments) {
    const encodedSegment = encodeUrlPathSegment(segment)
    if (encodedSegment === null) return null
    encoded.push(encodedSegment)
  }

  const relativePath = encoded.join('/')
  return encoded[0] === '..' ? relativePath : `./${relativePath}`
}
