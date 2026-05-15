/**
 * Minimal browser shim for the Node `path` module.
 *
 * Only covers the surface that the renderer's deps actually touch (fuzzaldrin
 * uses `.sep`; Muya's image-path code uses `.resolve`, which we already
 * inlined in `muya/lib/utils/index.js`). Anything else throws so missing
 * coverage is loud.
 */

export const sep = '/'
export const delimiter = ':'
export const posix = { sep: '/', delimiter: ':' }
export const win32 = { sep: '\\', delimiter: ';' }

export function basename(p, ext) {
  const norm = String(p || '').replace(/\\/g, '/')
  let base = norm.slice(norm.lastIndexOf('/') + 1)
  if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length)
  return base
}

export function dirname(p) {
  const norm = String(p || '').replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  return idx < 0 ? '.' : norm.slice(0, idx) || '/'
}

export function extname(p) {
  const norm = String(p || '').replace(/\\/g, '/')
  const base = norm.slice(norm.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot)
}

export function join(...parts) {
  return parts
    .filter(Boolean)
    .map(p => String(p).replace(/\\/g, '/'))
    .join('/')
    .replace(/\/+/g, '/')
}

export function normalize(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/')
}

export function resolve(...parts) {
  let out = ''
  for (const p of parts) {
    if (!p) continue
    const s = String(p).replace(/\\/g, '/')
    if (s.startsWith('/') || /^[a-zA-Z]:\//.test(s)) out = s
    else out = out ? `${out}/${s}` : s
  }
  return out.replace(/\/+/g, '/')
}

export function isAbsolute(p) {
  const s = String(p || '')
  return s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s)
}

export function relative(from, to) {
  // Lightweight relative — good enough for fuzzy-matching use.
  const fromN = normalize(from).split('/').filter(Boolean)
  const toN = normalize(to).split('/').filter(Boolean)
  let i = 0
  while (i < fromN.length && i < toN.length && fromN[i] === toN[i]) i++
  return [...fromN.slice(i).map(() => '..'), ...toN.slice(i)].join('/') || '.'
}

export function parse(p) {
  const norm = normalize(p)
  const dir = dirname(norm)
  const base = basename(norm)
  const ext = extname(base)
  return { root: norm.startsWith('/') ? '/' : '', dir, base, ext, name: base.slice(0, base.length - ext.length) }
}

export default {
  sep,
  delimiter,
  posix,
  win32,
  basename,
  dirname,
  extname,
  join,
  normalize,
  resolve,
  isAbsolute,
  relative,
  parse,
}
