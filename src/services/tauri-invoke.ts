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
}

export interface SaveOptions {
  encoding?: string
  lineEnding?: string
}

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  isMarkdown: boolean
  size: number
  modifiedMs: number
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
}

export interface SearchHit {
  path: string
  line: number
  column: number
  preview: string
}

/* ─── file ───────────────────────────────────────────────────── */

export const openFiles = () => invoke<string[]>('cmd_open_files')

export const readMarkdown = (path: string) =>
  invoke<LoadedDocument>('cmd_read_markdown', { path })

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

export const setAlwaysOnTop = (label: string, onTop: boolean) =>
  invoke<void>('cmd_set_always_on_top', { label, onTop })

export const openSettings = () => invoke<void>('cmd_open_settings')

/* ─── preferences ────────────────────────────────────────────── */

export const getPreferences = () =>
  invoke<Record<string, unknown>>('cmd_get_preferences')

export const getPreference = <T = unknown>(key: string) =>
  invoke<T | null>('cmd_get_preference', { key })

export const setPreference = (key: string, value: unknown) =>
  invoke<void>('cmd_set_preference', { key, value })

export const setPreferences = (patch: Record<string, unknown>) =>
  invoke<void>('cmd_set_preferences', { patch })

export const getUserData = () =>
  invoke<Record<string, unknown>>('cmd_get_user_data')

export const setUserData = (patch: Record<string, unknown>) =>
  invoke<void>('cmd_set_user_data', { patch })

/* ─── export ─────────────────────────────────────────────────── */

export const exportHtml = (path: string, html: string) =>
  invoke<void>('cmd_export_html', { path, html })

export const exportPdf = (windowLabel: string) =>
  invoke<void>('cmd_export_pdf', { windowLabel })

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

export const spellcheckAddWord = (word: string) =>
  invoke<void>('cmd_spellcheck_add_word', { word })

export const spellcheckRemoveWord = (word: string) =>
  invoke<void>('cmd_spellcheck_remove_word', { word })

export const spellcheckAvailableDictionaries = () =>
  invoke<string[]>('cmd_spellcheck_available_dictionaries')
