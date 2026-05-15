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
}

export interface TreeFolder {
  id: string
  name: string
  pathname: string
  isCollapsed: boolean
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

function ensureFolder(parent: TreeFolder, name: string, fullPath: string): TreeFolder {
  let child = parent.folders.find(f => f.name === name)
  if (child) return child
  child = {
    id: uuid(),
    pathname: fullPath,
    name,
    isCollapsed: true,
    isDirectory: true,
    isFile: false,
    isMarkdown: false,
    folders: [],
    files: [],
  }
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
  if (currentFolder.files.some(f => f.pathname === file.pathname)) return
  const fileCopy: TreeFile = {
    id: uuid(),
    name: file.name,
    pathname: file.pathname,
    isDirectory: false,
    isFile: true,
    isMarkdown: !!file.isMarkdown,
    birthTime: file.birthTime,
  }
  const idx = currentFolder.files.findIndex(f => f.name.localeCompare(file.name) > 0)
  if (idx === -1) currentFolder.files.push(fileCopy)
  else currentFolder.files.splice(idx, 0, fileCopy)
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
  const name = pathname.split(SEP_RE).filter(Boolean).pop() ?? pathname
  return {
    id: uuid(),
    name,
    pathname,
    isCollapsed: false,
    isFile: false,
    isDirectory: true,
    isMarkdown: false,
    folders: [],
    files: [],
  }
}
