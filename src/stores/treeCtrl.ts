/**
 * File-tree mutators — port of the legacy `store/treeCtrl.js`.
 *
 * Used by the `project` Pinia store to keep an in-memory mirror of the
 * watched folder. Pure functions, no IPC; the underlying FS watching is in
 * Rust (`mt://fs/change` events).
 */

import { v4 as uuid } from '@/util/uuid'
import { dirname as posixDirname, normalize, sep as POSIX_SEP } from '@/common/node-shims/path'

export interface TreeFile {
  id: string
  name: string
  pathname: string
  isFile: true
  isDirectory: false
  isMarkdown: boolean
  birthTime?: number
  modifiedTime?: number
}

export interface TreeFolder {
  id: string
  name: string
  pathname: string
  isCollapsed: boolean
  /** Whether this folder's direct children have been listed from disk. */
  loaded: boolean
  /** True while the direct-child listing is in flight. */
  loading: boolean
  /** Last direct-child listing failure. A retry clears this field. */
  loadError: string | null
  isFile: false
  isDirectory: true
  isMarkdown: false
  folders: TreeFolder[]
  files: TreeFile[]
}

const SEP_RE = /[\\/]/

function relativeSegments(rootPath: string, target: string): string[] {
  const r = normalize(rootPath)
  const t = normalize(target)
  if (!t.startsWith(r)) return t.split(SEP_RE).filter(Boolean)
  const rel = t.slice(r.length).replace(/^[\\/]+/, '')
  return rel ? rel.split(SEP_RE).filter(Boolean) : []
}

export function makeFolder(pathname: string, isCollapsed = true): TreeFolder {
  const name = pathname.split(SEP_RE).filter(Boolean).pop() ?? pathname
  return {
    id: uuid(),
    pathname,
    name,
    isCollapsed,
    loaded: false,
    loading: false,
    loadError: null,
    isDirectory: true,
    isFile: false,
    isMarkdown: false,
    folders: [],
    files: [],
  }
}

export function makeFile(file: Omit<TreeFile, 'id'>): TreeFile {
  return {
    id: uuid(),
    name: file.name,
    pathname: file.pathname,
    isDirectory: false,
    isFile: true,
    isMarkdown: !!file.isMarkdown,
    birthTime: file.birthTime,
    modifiedTime: file.modifiedTime,
  }
}

function ensureFolder(parent: TreeFolder, name: string, fullPath: string): TreeFolder {
  let child = parent.folders.find(f => f.name === name)
  if (child) return child
  child = makeFolder(fullPath)
  child.name = name
  parent.folders.push(child)
  // Keep folders alphabetised so the tree doesn't shuffle on each add.
  parent.folders.sort((a, b) => a.name.localeCompare(b.name))
  return child
}

export function addFile(tree: TreeFolder, file: Omit<TreeFile, 'id'>): void {
  const parentDir = posixDirname(file.pathname)
  const segments = relativeSegments(tree.pathname, parentDir)
  let currentPath = tree.pathname
  let currentFolder: TreeFolder = tree
  for (const name of segments) {
    currentPath = `${currentPath}${POSIX_SEP}${name}`
    currentFolder = ensureFolder(currentFolder, name, currentPath)
  }
  const existing = currentFolder.files.find(f => f.pathname === file.pathname)
  if (existing) {
    existing.name = file.name
    existing.isMarkdown = !!file.isMarkdown
    existing.birthTime = file.birthTime
    existing.modifiedTime = file.modifiedTime
    return
  }
  const fileCopy = makeFile(file)
  const idx = currentFolder.files.findIndex(f => f.name.localeCompare(file.name) > 0)
  if (idx === -1) currentFolder.files.push(fileCopy)
  else currentFolder.files.splice(idx, 0, fileCopy)
}

export type TreeSortMode = 'created' | 'modified' | 'title'

/** Sort one folder's direct children. */
export function sortFolder(folder: TreeFolder, mode: TreeSortMode): void {
  folder.folders.sort((a, b) => a.name.localeCompare(b.name))
  folder.files.sort((a, b) => {
    if (mode === 'title') return a.name.localeCompare(b.name)
    const aTime = mode === 'created' ? (a.birthTime ?? 0) : (a.modifiedTime ?? 0)
    const bTime = mode === 'created' ? (b.birthTime ?? 0) : (b.modifiedTime ?? 0)
    return bTime - aTime || a.name.localeCompare(b.name)
  })
}

/** Sort loaded file collections in place without recursive call-stack growth. */
export function sortTree(tree: TreeFolder, mode: TreeSortMode): void {
  const pending = [tree]
  while (pending.length) {
    const folder = pending.pop()!
    sortFolder(folder, mode)
    pending.push(...folder.folders)
  }
}

export function addDirectory(tree: TreeFolder, dir: Pick<TreeFolder, 'pathname'>): void {
  const segments = relativeSegments(tree.pathname, dir.pathname)
  let currentPath = tree.pathname
  let currentFolder: TreeFolder = tree
  for (const name of segments) {
    currentPath = `${currentPath}${POSIX_SEP}${name}`
    currentFolder = ensureFolder(currentFolder, name, currentPath)
  }
}

export function unlinkFile(tree: TreeFolder, file: Pick<TreeFile, 'pathname'>): void {
  const segments = relativeSegments(tree.pathname, posixDirname(file.pathname))
  let currentFolder: TreeFolder = tree
  for (const name of segments) {
    const child = currentFolder.folders.find(f => f.name === name)
    if (!child) return
    currentFolder = child
  }
  const idx = currentFolder.files.findIndex(f => f.pathname === file.pathname)
  if (idx !== -1) currentFolder.files.splice(idx, 1)
}

export function unlinkDirectory(tree: TreeFolder, dir: Pick<TreeFolder, 'pathname'>): void {
  const segments = relativeSegments(tree.pathname, dir.pathname)
  segments.pop() // drop the dir itself; we work on its parent
  let folders: TreeFolder[] = tree.folders
  for (const name of segments) {
    const child = folders.find(f => f.name === name)
    if (!child) return
    folders = child.folders
  }
  const idx = folders.findIndex(f => f.pathname === dir.pathname)
  if (idx !== -1) folders.splice(idx, 1)
}

export function makeRoot(pathname: string): TreeFolder {
  return makeFolder(pathname, false)
}
