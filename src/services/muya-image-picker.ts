/**
 * Muya image-picker / autocomplete / clipboard callbacks.
 *
 * Muya's image dialog asks the host for three callbacks (see
 * `src/muya/lib/config/index.js`):
 *
 *   - `imagePathPicker()`     → resolve a single absolute image path
 *   - `imagePathAutoComplete(prefix)` → list candidate paths matching a prefix
 *   - `clipboardFilePath()`   → if the system clipboard holds a file *path*
 *                                (not data), return it so paste-image uses it
 *
 * The original Electron version of these called Node directly; under Tauri we
 * route through `@tauri-apps/plugin-dialog` for the picker and the
 * `cmd_list_directory` command for autocomplete. Clipboard-file-path detection
 * isn't implemented (Tauri 2's clipboard plugin only surfaces text/image
 * payloads) — return empty so Muya falls through to the normal paste path.
 */
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { listDirectory } from './tauri-invoke'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']

export async function muyaImagePathPicker(): Promise<string> {
  try {
    const picked = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: 'Images', extensions: IMAGE_EXTS }],
    })
    if (typeof picked === 'string') return picked
    return ''
  } catch (err) {
    console.warn('[muyaImagePathPicker]', err)
    return ''
  }
}

/**
 * Return a list of paths whose basename starts with the user's prefix.
 *
 * Muya passes whatever sits between the last separator and the cursor as
 * `query`. We split off the parent dir, list it, and filter to image-looking
 * entries that start with the trailing tail.
 */
export async function muyaImagePathAutoComplete(query: string): Promise<string[]> {
  if (!query) return []
  const norm = query.replace(/\\/g, '/')
  const lastSlash = norm.lastIndexOf('/')
  if (lastSlash < 0) return []
  const dir = norm.slice(0, lastSlash) || '/'
  const tail = norm.slice(lastSlash + 1).toLowerCase()
  try {
    const entries = await listDirectory(dir)
    return entries
      .filter(e => e.name.toLowerCase().startsWith(tail))
      .filter(e => e.isDir || IMAGE_EXTS.some(x => e.name.toLowerCase().endsWith('.' + x)))
      .slice(0, 50)
      .map(e => e.path)
  } catch {
    return []
  }
}

/**
 * Best-effort clipboard-as-file-path detection.
 *
 * Muya's `pasteImage` calls this synchronously to check whether the system
 * clipboard contains a file path (e.g. when the user copied a file from
 * Finder/Explorer and pastes it into the editor). Tauri 2's clipboard plugin
 * read is async, so we keep a small cache that we refresh on every paste /
 * focus / Ctrl-V keystroke. If the cached value looks like an image path,
 * we hand it back; otherwise we fall through to the normal blob-paste flow.
 *
 * The regex matches both POSIX-style (`/Users/foo/img.png`) and
 * Windows-style (`C:\Users\foo\img.png`) absolute paths with a known image
 * extension. URLs are excluded — `pasteImage` already handles those via the
 * dataURL branch.
 */
const FILE_PATH_RE = /^(?:[a-zA-Z]:[\\/]|\/|\\\\)[^\r\n]+\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i
let cachedClipboardPath: string = ''
let refreshingClipboard = false
let refreshPromise: Promise<void> | null = null

async function refreshClipboardCache(): Promise<void> {
  if (refreshingClipboard) return refreshPromise ?? Promise.resolve()
  refreshingClipboard = true
  refreshPromise = (async () => {
    try {
      const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
      const text = (await readText())?.trim() ?? ''
      cachedClipboardPath = FILE_PATH_RE.test(text) ? text : ''
    } catch {
      cachedClipboardPath = ''
    } finally {
      refreshingClipboard = false
    }
  })()
  return refreshPromise
}

function installClipboardCacheBumpers() {
  if (typeof window === 'undefined') return
  const bump = () => { void refreshClipboardCache() }
  window.addEventListener('focus', bump)
  window.addEventListener('paste', bump, true)
  window.addEventListener('keydown', ev => {
    const v = (ev.key === 'v' || ev.key === 'V')
    const mod = ev.ctrlKey || ev.metaKey
    if (v && mod) bump()
  }, true)
  // Kick off an initial refresh so first paste right after launch has data.
  bump()
}
installClipboardCacheBumpers()

export function muyaClipboardFilePath(): string {
  // Trigger a refresh for the *next* call too — `pasteImage` is async after
  // this point, so by the time the second branch runs the cache is fresh.
  void refreshClipboardCache()
  return cachedClipboardPath
}
