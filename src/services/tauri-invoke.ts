/**
 * Strongly-typed wrappers around `invoke()` for every Tauri command.
 *
 * One file = one source of truth: the command names mirror the function
 * signatures registered in `src-tauri/src/commands/mod.rs::all()`. Renaming a
 * command here breaks compilation if the Rust side doesn't match.
 *
 * Add a wrapper here BEFORE calling any command from a component.
 */

import { invoke } from '@tauri-apps/api/core'

/* ─── shared types ───────────────────────────────────────────── */

export interface LoadedDocument {
  path: string
  markdown: string
  encoding: string
  lineEnding: string
  hadDecodeErrors: boolean
  bom: boolean
}

export interface SaveOptions {
  encoding?: string
  lineEnding?: string
  bom?: boolean
}

export interface ReadOptions {
  autoGuessEncoding?: boolean
  defaultEncoding?: string
}

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  isMarkdown: boolean
  size: number
  modifiedMs: number
  createdMs?: number
}

export interface SearchArgs {
  root: string
  query: string
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
  includeHidden?: boolean
  followSymlinks?: boolean
  maxFileSize?: number
  exclusions?: string[]
  noIgnore?: boolean
}

export interface SearchHit {
  path: string
  line: number
  column: number
  preview: string
}

/* ─── file ───────────────────────────────────────────────────── */

export const openFiles = () => invoke<string[]>('cmd_open_files')

export const readMarkdown = (path: string, options?: ReadOptions) =>
  invoke<LoadedDocument>('cmd_read_markdown', { path, options })

export const saveMarkdown = (path: string, markdown: string, options?: SaveOptions) =>
  invoke<void>('cmd_save_markdown', { path, markdown, options })

export const saveAsDialog = (defaultName?: string, defaultDir?: string) =>
  invoke<string | null>('cmd_save_as_dialog', { defaultName, defaultDir })

export const renameFile = (from: string, to: string) =>
  invoke<void>('cmd_rename_file', { from, to })

export const trashFile = (path: string) => invoke<void>('cmd_trash_file', { path })

/* ─── workspace ──────────────────────────────────────────────── */

export const openFolder = () => invoke<string | null>('cmd_open_folder')

export const listDirectory = (path: string) =>
  invoke<DirEntry[]>('cmd_list_directory', { path })

export const watchFolder = (path: string) => invoke<void>('cmd_watch_folder', { path })

export const unwatchFolder = (path: string) =>
  invoke<void>('cmd_unwatch_folder', { path })

/* ─── window ─────────────────────────────────────────────────── */

export const newWindow = (label?: string) => invoke<void>('cmd_new_window', { label })

export const closeWindow = (label: string) =>
  invoke<void>('cmd_close_window', { label })

export const destroySettingsWindow = () => isTauriRuntime()
  ? invoke<void>('cmd_destroy_settings_window')
  : Promise.resolve()

export const setAlwaysOnTop = (label: string, onTop: boolean) =>
  invoke<void>('cmd_set_always_on_top', { label, onTop })

export const setMenuAcceleratorsEnabled = (enabled: boolean) => isTauriRuntime()
  ? invoke<void>('cmd_set_menu_accelerators_enabled', { enabled })
  : Promise.resolve()

const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const browserPreferences: Record<string, unknown> = {}
let browserUserData: Record<string, unknown> = {}

function deepMergeRecord(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged = structuredClone(current)
  for (const [key, value] of Object.entries(patch)) {
    const existing = merged[key]
    merged[key] = value && typeof value === 'object' && !Array.isArray(value)
      && existing && typeof existing === 'object' && !Array.isArray(existing)
      ? deepMergeRecord(existing as Record<string, unknown>, value as Record<string, unknown>)
      : structuredClone(value)
  }
  return merged
}

export const openSettings = () => {
  if (!isTauriRuntime()) {
    if (typeof window !== 'undefined') window.location.hash = '/preferences'
    return Promise.resolve()
  }
  return invoke<void>('cmd_open_settings')
}

/* ─── preferences ────────────────────────────────────────────── */

export const getPreferences = () => isTauriRuntime()
  ? invoke<Record<string, unknown>>('cmd_get_preferences')
  : Promise.resolve({ ...browserPreferences })

export const getPreference = <T = unknown>(key: string) => isTauriRuntime()
  ? invoke<T | null>('cmd_get_preference', { key })
  : Promise.resolve((browserPreferences[key] as T | undefined) ?? null)

export const setPreference = (key: string, value: unknown) => {
  if (!isTauriRuntime()) {
    browserPreferences[key] = structuredClone(value)
    return Promise.resolve()
  }
  return invoke<void>('cmd_set_preference', { key, value })
}

export const setPreferences = (patch: Record<string, unknown>) => {
  if (!isTauriRuntime()) {
    Object.assign(browserPreferences, structuredClone(patch))
    return Promise.resolve()
  }
  return invoke<void>('cmd_set_preferences', { patch })
}

export const pushRecentPath = (key: 'recentFiles' | 'recentFolders', path: string) => {
  if (!isTauriRuntime()) {
    const current = Array.isArray(browserPreferences[key])
      ? (browserPreferences[key] as string[]).filter(value => value !== path)
      : []
    const recent = [path, ...current].slice(0, 20)
    browserPreferences[key] = recent
    return Promise.resolve(recent)
  }
  return invoke<string[]>('cmd_push_recent', { key, path })
}

export const getUserData = () => isTauriRuntime()
  ? invoke<Record<string, unknown>>('cmd_get_user_data')
  : Promise.resolve(structuredClone(browserUserData))

export const setUserData = (patch: Record<string, unknown>) => {
  if (!isTauriRuntime()) {
    browserUserData = deepMergeRecord(browserUserData, patch)
    return Promise.resolve()
  }
  return invoke<void>('cmd_set_user_data', { patch })
}

/* ─── export ─────────────────────────────────────────────────── */

export const exportHtml = (path: string, html: string) =>
  invoke<void>('cmd_export_html', { path, html })

export const exportPdf = (windowLabel: string) =>
  invoke<void>('cmd_export_pdf', { windowLabel })

export const pandocConvert = (markdown: string, outputPath: string, outputFormat: string) =>
  invoke<void>('cmd_pandoc_convert', { markdown, outputPath, outputFormat })

export interface PandocPdfOptions {
  paperSize?: string
  orientation?: 'portrait' | 'landscape'
  title?: string
  toc?: boolean
}

export const pandocPdfExport = (markdown: string, outputPath: string, options?: PandocPdfOptions) =>
  invoke<void>('cmd_pandoc_pdf_export', { markdown, outputPath, options })

/* ─── image ──────────────────────────────────────────────────── */

export interface LocalSaveArgs {
  sourcePath?: string
  dataUrl?: string
  targetDir: string
  filename: string
}

export const saveImageLocal = (args: LocalSaveArgs) =>
  invoke<{ path: string }>('cmd_save_image_local', { args })

export interface GithubUploadArgs {
  token: string
  owner: string
  repo: string
  branch?: string
  path: string
  contentBase64: string
  message?: string
}

export const uploadImageGithub = (args: GithubUploadArgs) =>
  invoke<{ downloadUrl: string; sha: string }>('cmd_upload_image_github', { args })

export interface PicgoUploadArgs {
  binary?: string
  sourcePaths: string[]
}
export const uploadImagePicgo = (args: PicgoUploadArgs) =>
  invoke<{ urls: string[] }>('cmd_upload_image_picgo', { args })

export interface ScriptUploadArgs {
  script: string
  sourcePaths: string[]
}
export const uploadImageScript = (args: ScriptUploadArgs) =>
  invoke<{ urls: string[] }>('cmd_upload_image_script', { args })

export interface UnsplashSearchArgs {
  query: string
  page?: number
  perPage?: number
  accessKey: string
}

export const searchUnsplash = (args: UnsplashSearchArgs) =>
  invoke<unknown>('cmd_search_unsplash', { args })

/* ─── search ─────────────────────────────────────────────────── */

export const searchInFolder = (args: SearchArgs) =>
  invoke<SearchHit[]>('cmd_search_in_folder', { args })

/* ─── spellcheck ─────────────────────────────────────────────── */

export const spellcheckWords = (words: string[]) =>
  invoke<string[]>('cmd_spellcheck_words', { words })

export const spellcheckSuggest = (word: string) =>
  invoke<string[]>('cmd_spellcheck_suggest', { word })

export const spellcheckAddWord = (word: string) =>
  invoke<void>('cmd_spellcheck_add_word', { word })

export const spellcheckRemoveWord = (word: string) =>
  invoke<void>('cmd_spellcheck_remove_word', { word })

export const spellcheckAvailableDictionaries = () =>
  isTauriRuntime()
    ? invoke<string[]>('cmd_spellcheck_available_dictionaries')
    : Promise.resolve([])

/* ─── menu state ─────────────────────────────────────────────── */

/**
 * Update the ✓ marks on the native Format submenu's inline items.
 *
 * Pass the flat list of "active" token names Muya reports at the current
 * selection — e.g. `['strong', 'em']` when the cursor is on **bold *italic***
 * text. Unknown names are ignored; an empty array clears every check.
 */
export const setFormatMenuState = (formats: string[]) =>
  invoke<void>('cmd_set_format_menu_state', { formats })

/* ─── theme ──────────────────────────────────────────────────── */

export interface UserTheme {
  id: string
  name: string
  path: string
}

export const listThemes = () => isTauriRuntime()
  ? invoke<UserTheme[]>('cmd_list_themes')
  : Promise.resolve([])

export const readThemeCss = (path: string) =>
  invoke<string>('cmd_read_theme_css', { path })
