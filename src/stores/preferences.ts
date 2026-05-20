/**
 * Preferences store — drop-in replacement for the original
 * `marktext/src/renderer/store/preferences.js` (Vuex) module, ported to
 * Pinia 2.
 *
 * The state shape is identical to the legacy module so component templates
 * can keep using the same keys. Reads/writes go through Tauri commands.
 */

import { defineStore } from 'pinia'
import type { AppIconId } from '@/services/app-icon'
import {
  getPreferences,
  setPreference,
  setPreferences,
  getUserData,
  setUserData,
} from '@/services/tauri-invoke'

type Pref = string | number | boolean | string[] | Record<string, unknown>

interface State {
  // General
  autoSave: boolean
  autoSaveDelay: number
  titleBarStyle: 'custom' | 'native'
  rememberWindowSize: boolean
  appIcon: AppIconId
  openFilesInNewWindow: boolean
  openFolderInNewWindow: boolean
  zoom: number
  hideScrollbar: boolean
  wordWrapInToc: boolean
  fileSortBy: 'created' | 'modified' | 'title'
  startUpAction: 'folder' | 'lastState' | 'blank'
  defaultDirectoryToOpen: string
  language: string

  // Editor
  editorFontFamily: string
  fontSize: number
  lineHeight: number
  codeFontSize: number
  codeFontFamily: string
  codeBlockLineNumbers: boolean
  trimUnnecessaryCodeBlockEmptyLines: boolean
  editorLineWidth: string
  autoPairBracket: boolean
  autoPairMarkdownSyntax: boolean
  autoPairQuote: boolean
  endOfLine: 'default' | 'lf' | 'crlf'
  defaultEncoding: string
  autoGuessEncoding: boolean
  trimTrailingNewline: number
  textDirection: 'ltr' | 'rtl'
  hideQuickInsertHint: boolean
  imageInsertAction: 'folder' | 'path' | 'upload'
  imagePreferRelativeDirectory: boolean
  imageRelativeDirectoryName: string
  hideLinkPopup: boolean
  autoCheck: boolean

  // Markdown
  preferLooseListItem: boolean
  bulletListMarker: '-' | '+' | '*'
  orderListDelimiter: '.' | ')'
  preferHeadingStyle: 'atx' | 'setext'
  tabSize: number
  listIndentation: number
  frontmatterType: '-' | '+' | ';' | '{'
  superSubScript: boolean
  footnote: boolean
  isHtmlEnabled: boolean
  isGitlabCompatibilityEnabled: boolean
  sequenceTheme: string

  // Theme
  theme: string
  autoSwitchTheme: number

  // Spellcheck
  spellcheckerEnabled: boolean
  spellcheckerNoUnderline: boolean
  spellcheckerLanguage: string

  // View
  sideBarVisibility: boolean
  tabBarVisibility: boolean
  sourceCodeModeEnabled: boolean

  // Search
  searchExclusions: string[]
  searchMaxFileSize: string
  searchIncludeHidden: boolean
  searchNoIgnore: boolean
  searchFollowSymlinks: boolean

  // Watcher
  watcherUsePolling: boolean

  // Window-only modes (not persisted)
  typewriter: boolean
  focus: boolean
  sourceCode: boolean

  // User data (per-user, not per-prefs)
  imageFolderPath: string
  webImages: unknown[]
  cloudImages: unknown[]
  currentUploader: 'none' | 'github' | 's3'
  githubToken: string
  imageBed: { github: { owner: string; repo: string; branch: string } }
  cliScript: string

  // Recent files/folders. Capped to ~20 entries each; managed by the editor /
  // project stores via `pushRecentFile` / `pushRecentFolder`.
  recentFiles: string[]
  recentFolders: string[]
}

const defaults: State = {
  autoSave: false,
  autoSaveDelay: 5000,
  titleBarStyle: 'custom',
  rememberWindowSize: false,
  appIcon: 'ios26',
  openFilesInNewWindow: false,
  openFolderInNewWindow: false,
  zoom: 1.0,
  hideScrollbar: false,
  wordWrapInToc: false,
  fileSortBy: 'created',
  startUpAction: 'lastState',
  defaultDirectoryToOpen: '',
  language: 'zh-CN',

  editorFontFamily: 'Open Sans',
  fontSize: 16,
  lineHeight: 1.6,
  codeFontSize: 14,
  codeFontFamily: 'DejaVu Sans Mono',
  codeBlockLineNumbers: true,
  trimUnnecessaryCodeBlockEmptyLines: true,
  editorLineWidth: '',
  autoPairBracket: true,
  autoPairMarkdownSyntax: true,
  autoPairQuote: true,
  endOfLine: 'default',
  defaultEncoding: 'utf8',
  autoGuessEncoding: true,
  trimTrailingNewline: 2,
  textDirection: 'ltr',
  hideQuickInsertHint: false,
  imageInsertAction: 'folder',
  imagePreferRelativeDirectory: false,
  imageRelativeDirectoryName: 'assets',
  hideLinkPopup: false,
  autoCheck: false,

  preferLooseListItem: true,
  bulletListMarker: '-',
  orderListDelimiter: '.',
  preferHeadingStyle: 'atx',
  tabSize: 4,
  listIndentation: 1,
  frontmatterType: '-',
  superSubScript: false,
  footnote: false,
  isHtmlEnabled: true,
  isGitlabCompatibilityEnabled: false,
  sequenceTheme: 'hand',

  theme: 'light',
  autoSwitchTheme: 2,

  spellcheckerEnabled: false,
  spellcheckerNoUnderline: false,
  spellcheckerLanguage: 'en-US',

  sideBarVisibility: true,
  tabBarVisibility: false,
  sourceCodeModeEnabled: false,

  searchExclusions: [],
  searchMaxFileSize: '',
  searchIncludeHidden: false,
  searchNoIgnore: false,
  searchFollowSymlinks: true,

  watcherUsePolling: false,

  typewriter: false,
  focus: false,
  sourceCode: false,

  imageFolderPath: '',
  webImages: [],
  cloudImages: [],
  currentUploader: 'none',
  githubToken: '',
  imageBed: { github: { owner: '', repo: '', branch: '' } },
  cliScript: '',

  recentFiles: [],
  recentFolders: [],
}

export const usePreferencesStore = defineStore('preferences', {
  state: (): State => ({ ...defaults }),

  actions: {
    async load() {
      const prefs = (await getPreferences().catch(() => null)) ?? {}
      const user = (await getUserData().catch(() => null)) ?? {}
      for (const k of Object.keys(prefs)) {
        if (k in this.$state) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(this as any)[k] = (prefs as any)[k]
        }
      }
      for (const k of Object.keys(user)) {
        if (k in this.$state) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(this as any)[k] = (user as any)[k]
        }
      }
    },

    async set<K extends keyof State>(key: K, value: State[K]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(this as any)[key] = value
      await setPreference(key as string, value as unknown as Pref)
    },

    async patch(patch: Partial<State>) {
      Object.assign(this, patch)
      await setPreferences(patch as Record<string, unknown>)
    },

    async patchUserData(patch: Partial<State>) {
      Object.assign(this, patch)
      await setUserData(patch as Record<string, unknown>)
    },

    toggleViewMode(entry: keyof State) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(this as any)[entry] = !(this as any)[entry]
    },

    pushRecentFile(path: string) {
      const cur = this.recentFiles.filter(p => p !== path)
      cur.unshift(path)
      this.recentFiles = cur.slice(0, 20)
      void setPreference('recentFiles', this.recentFiles)
    },

    pushRecentFolder(path: string) {
      const cur = this.recentFolders.filter(p => p !== path)
      cur.unshift(path)
      this.recentFolders = cur.slice(0, 20)
      void setPreference('recentFolders', this.recentFolders)
    },

    clearRecents() {
      this.recentFiles = []
      this.recentFolders = []
      void setPreferences({ recentFiles: [], recentFolders: [] })
    },
  },
})

export type PreferencesState = State
