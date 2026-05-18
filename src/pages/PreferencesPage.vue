<script setup lang="ts">
/**
 * Preferences window — sectioned settings UI.
 *
 * Each section maps to one cluster from the original
 * `marktext/src/renderer/prefComponents/`. Writes go straight through the
 * preferences store (which persists via tauri-plugin-store), so changes are
 * effective immediately. Edits made here propagate to other open windows via
 * the Rust-emitted `mt://prefs/changed` event.
 */
import { computed, onMounted, ref } from 'vue'
import { usePreferencesStore } from '@/stores/preferences'
import { useListenForMainStore } from '@/stores/listenForMain'
import { useKeybindingsStore, eventAccel } from '@/stores/keybindings'
import { applyPreferencesToDom, invalidateUserThemes } from '@/services/preferences-applier'
import { listThemes, getPreference, type UserTheme } from '@/services/tauri-invoke'
import { appIconOptions, type AppIconId } from '@/services/app-icon'

const prefs = usePreferencesStore()
const listener = useListenForMainStore()
const keys = useKeybindingsStore()
const userThemes = ref<UserTheme[]>([])

/* ── keybindings UI state ─────────────────────────────────────── */
const editingAccel = ref<string | null>(null)   // action id currently being recorded
const recordedAccel = ref<string>('')

function startEdit(actionId: string) {
  editingAccel.value = actionId
  recordedAccel.value = ''
}

function onAccelKey(ev: KeyboardEvent) {
  if (!editingAccel.value) return
  ev.preventDefault()
  // Ignore lone modifier keys — wait for the user to press the actual key.
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(ev.key)) return
  recordedAccel.value = eventAccel(ev)
}

function cancelEdit() {
  editingAccel.value = null
  recordedAccel.value = ''
}

async function applyAccel() {
  if (!editingAccel.value || !recordedAccel.value) return
  await keys.set(editingAccel.value, recordedAccel.value)
  editingAccel.value = null
  recordedAccel.value = ''
}

async function reloadUserThemes() {
  invalidateUserThemes()
  try { userThemes.value = await listThemes() } catch { userThemes.value = [] }
}

type SectionId =
  | 'general'
  | 'editor'
  | 'markdown'
  | 'theme'
  | 'image'
  | 'spellchecker'
  | 'view'
  | 'search'
  | 'keybindings'

const sections: { id: SectionId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'editor', label: 'Editor' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'theme', label: 'Theme' },
  { id: 'image', label: 'Image' },
  { id: 'spellchecker', label: 'Spellchecker' },
  { id: 'view', label: 'View' },
  { id: 'search', label: 'Search' },
  { id: 'keybindings', label: 'Keybindings' },
]

const active = ref<SectionId>('general')

const fontSize = computed({
  get: () => prefs.fontSize,
  set: v => { void prefs.set('fontSize', Number(v)) },
})

onMounted(async () => {
  await prefs.load()
  applyPreferencesToDom()
  await listener.install()
  await reloadUserThemes()
  try {
    const persisted = await getPreference<Record<string, string>>('keybindings')
    if (persisted) keys.hydrate(persisted)
  } catch { /* ignore */ }
})
</script>

<template>
  <div class="prefs-page">
    <aside class="prefs-nav">
      <h2 class="prefs-title">Preferences</h2>
      <ul>
        <li
          v-for="sec in sections"
          :key="sec.id"
          :class="{ active: active === sec.id }"
          @click="active = sec.id"
        >
          {{ sec.label }}
        </li>
      </ul>
    </aside>

    <main class="prefs-body">
      <!-- ── General ─────────────────────────────────────── -->
      <section v-show="active === 'general'" class="prefs-section">
        <h3>General</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item label="Auto save">
            <el-switch :model-value="prefs.autoSave" @update:model-value="v => prefs.set('autoSave', !!v)" />
          </el-form-item>
          <el-form-item label="Auto-save delay (ms)">
            <el-input-number
              :model-value="prefs.autoSaveDelay"
              :min="1000"
              :step="500"
              @update:model-value="v => prefs.set('autoSaveDelay', Number(v))"
            />
          </el-form-item>
          <el-form-item label="Title bar style">
            <el-select
              :model-value="prefs.titleBarStyle"
              style="width: 200px"
              @update:model-value="v => prefs.set('titleBarStyle', v as 'custom' | 'native')"
            >
              <el-option label="Custom" value="custom" />
              <el-option label="Native" value="native" />
            </el-select>
          </el-form-item>
          <el-form-item label="App icon">
            <div class="icon-choices">
              <button
                v-for="icon in appIconOptions"
                :key="icon.id"
                type="button"
                class="icon-choice"
                :class="{ selected: prefs.appIcon === icon.id }"
                @click="prefs.set('appIcon', icon.id as AppIconId)"
              >
                <img :src="icon.src" :alt="icon.label" />
                <span class="icon-choice-title">{{ icon.label }}</span>
                <span class="icon-choice-desc">{{ icon.description }}</span>
              </button>
            </div>
          </el-form-item>
          <el-form-item label="Open files in new window">
            <el-switch :model-value="prefs.openFilesInNewWindow" @update:model-value="v => prefs.set('openFilesInNewWindow', !!v)" />
          </el-form-item>
          <el-form-item label="Open folder in new window">
            <el-switch :model-value="prefs.openFolderInNewWindow" @update:model-value="v => prefs.set('openFolderInNewWindow', !!v)" />
          </el-form-item>
          <el-form-item label="Zoom level">
            <el-slider
              :model-value="prefs.zoom"
              :min="0.5"
              :max="2.0"
              :step="0.1"
              style="width: 220px"
              @update:model-value="v => prefs.set('zoom', Number(v))"
            />
          </el-form-item>
          <el-form-item label="Hide scrollbar">
            <el-switch :model-value="prefs.hideScrollbar" @update:model-value="v => prefs.set('hideScrollbar', !!v)" />
          </el-form-item>
          <el-form-item label="Word wrap in TOC">
            <el-switch :model-value="prefs.wordWrapInToc" @update:model-value="v => prefs.set('wordWrapInToc', !!v)" />
          </el-form-item>
          <el-form-item label="Sort files by">
            <el-select
              :model-value="prefs.fileSortBy"
              style="width: 200px"
              @update:model-value="v => prefs.set('fileSortBy', v as 'created' | 'modified' | 'title')"
            >
              <el-option label="Modified" value="modified" />
              <el-option label="Created" value="created" />
              <el-option label="Title" value="title" />
            </el-select>
          </el-form-item>
          <el-form-item label="On startup">
            <el-select
              :model-value="prefs.startUpAction"
              style="width: 200px"
              @update:model-value="v => prefs.set('startUpAction', v as 'folder' | 'lastState' | 'blank')"
            >
              <el-option label="Blank document" value="blank" />
              <el-option label="Restore last state" value="lastState" />
              <el-option label="Open folder" value="folder" />
            </el-select>
          </el-form-item>
          <el-form-item label="Language">
            <el-select
              :model-value="prefs.language"
              style="width: 200px"
              @update:model-value="v => prefs.set('language', v as string)"
            >
              <el-option label="English" value="en" />
              <el-option label="简体中文" value="zh-CN" />
            </el-select>
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Editor ─────────────────────────────────────── -->
      <section v-show="active === 'editor'" class="prefs-section">
        <h3>Editor</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item label="Font size (px)">
            <el-input-number v-model="fontSize" :min="12" :max="32" />
          </el-form-item>
          <el-form-item label="Line height">
            <el-input-number
              :model-value="prefs.lineHeight"
              :min="1.2"
              :max="2"
              :step="0.1"
              :precision="1"
              @update:model-value="v => prefs.set('lineHeight', Number(v))"
            />
          </el-form-item>
          <el-form-item label="Editor font family">
            <el-input
              :model-value="prefs.editorFontFamily"
              style="width: 240px"
              @update:model-value="v => prefs.set('editorFontFamily', String(v))"
            />
          </el-form-item>
          <el-form-item label="Editor max width">
            <el-input
              :model-value="prefs.editorLineWidth"
              placeholder="e.g. 860px / 80ch / 70%"
              style="width: 200px"
              @update:model-value="v => prefs.set('editorLineWidth', String(v))"
            />
          </el-form-item>
          <el-form-item label="Code font size (px)">
            <el-input-number
              :model-value="prefs.codeFontSize"
              :min="12"
              :max="28"
              @update:model-value="v => prefs.set('codeFontSize', Number(v))"
            />
          </el-form-item>
          <el-form-item label="Code font family">
            <el-input
              :model-value="prefs.codeFontFamily"
              style="width: 240px"
              @update:model-value="v => prefs.set('codeFontFamily', String(v))"
            />
          </el-form-item>
          <el-form-item label="Show code-block line numbers">
            <el-switch :model-value="prefs.codeBlockLineNumbers" @update:model-value="v => prefs.set('codeBlockLineNumbers', !!v)" />
          </el-form-item>
          <el-form-item label="Trim empty lines in code blocks">
            <el-switch :model-value="prefs.trimUnnecessaryCodeBlockEmptyLines" @update:model-value="v => prefs.set('trimUnnecessaryCodeBlockEmptyLines', !!v)" />
          </el-form-item>
          <el-form-item label="Auto pair brackets">
            <el-switch :model-value="prefs.autoPairBracket" @update:model-value="v => prefs.set('autoPairBracket', !!v)" />
          </el-form-item>
          <el-form-item label="Auto pair markdown syntax">
            <el-switch :model-value="prefs.autoPairMarkdownSyntax" @update:model-value="v => prefs.set('autoPairMarkdownSyntax', !!v)" />
          </el-form-item>
          <el-form-item label="Auto pair quotes">
            <el-switch :model-value="prefs.autoPairQuote" @update:model-value="v => prefs.set('autoPairQuote', !!v)" />
          </el-form-item>
          <el-form-item label="End of line">
            <el-select
              :model-value="prefs.endOfLine"
              style="width: 200px"
              @update:model-value="v => prefs.set('endOfLine', v as 'default' | 'lf' | 'crlf')"
            >
              <el-option label="System default" value="default" />
              <el-option label="LF (Unix)" value="lf" />
              <el-option label="CRLF (Windows)" value="crlf" />
            </el-select>
          </el-form-item>
          <el-form-item label="Default encoding">
            <el-select
              :model-value="prefs.defaultEncoding"
              style="width: 200px"
              @update:model-value="v => prefs.set('defaultEncoding', String(v))"
            >
              <el-option label="UTF-8" value="utf8" />
              <el-option label="UTF-16LE" value="utf16le" />
              <el-option label="UTF-16BE" value="utf16be" />
              <el-option label="GBK" value="gbk" />
              <el-option label="GB18030" value="gb18030" />
              <el-option label="Big5" value="big5" />
              <el-option label="Shift JIS" value="shiftjis" />
              <el-option label="EUC-JP" value="eucjp" />
              <el-option label="EUC-KR" value="euckr" />
              <el-option label="CP1252" value="cp1252" />
              <el-option label="Latin-1" value="iso885915" />
            </el-select>
          </el-form-item>
          <el-form-item label="Auto-guess encoding">
            <el-switch :model-value="prefs.autoGuessEncoding" @update:model-value="v => prefs.set('autoGuessEncoding', !!v)" />
          </el-form-item>
          <el-form-item label="Text direction">
            <el-select
              :model-value="prefs.textDirection"
              style="width: 200px"
              @update:model-value="v => prefs.set('textDirection', v as 'ltr' | 'rtl')"
            >
              <el-option label="Left to right" value="ltr" />
              <el-option label="Right to left" value="rtl" />
            </el-select>
          </el-form-item>
          <el-form-item label="Hide quick-insert hint">
            <el-switch :model-value="prefs.hideQuickInsertHint" @update:model-value="v => prefs.set('hideQuickInsertHint', !!v)" />
          </el-form-item>
          <el-form-item label="Hide link popup on hover">
            <el-switch :model-value="prefs.hideLinkPopup" @update:model-value="v => prefs.set('hideLinkPopup', !!v)" />
          </el-form-item>
          <el-form-item label="Auto-check task items">
            <el-switch :model-value="prefs.autoCheck" @update:model-value="v => prefs.set('autoCheck', !!v)" />
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Markdown ───────────────────────────────────── -->
      <section v-show="active === 'markdown'" class="prefs-section">
        <h3>Markdown</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item label="Prefer loose list items">
            <el-switch :model-value="prefs.preferLooseListItem" @update:model-value="v => prefs.set('preferLooseListItem', !!v)" />
          </el-form-item>
          <el-form-item label="Bullet list marker">
            <el-select
              :model-value="prefs.bulletListMarker"
              style="width: 120px"
              @update:model-value="v => prefs.set('bulletListMarker', v as '-' | '*' | '+')"
            >
              <el-option label="-" value="-" />
              <el-option label="*" value="*" />
              <el-option label="+" value="+" />
            </el-select>
          </el-form-item>
          <el-form-item label="Ordered list delimiter">
            <el-select
              :model-value="prefs.orderListDelimiter"
              style="width: 120px"
              @update:model-value="v => prefs.set('orderListDelimiter', v as '.' | ')')"
            >
              <el-option label="." value="." />
              <el-option label=")" value=")" />
            </el-select>
          </el-form-item>
          <el-form-item label="Preferred heading style">
            <el-select
              :model-value="prefs.preferHeadingStyle"
              style="width: 200px"
              @update:model-value="v => prefs.set('preferHeadingStyle', v as 'atx' | 'setext')"
            >
              <el-option label="ATX (# Heading)" value="atx" />
              <el-option label="Setext (Heading\\n===)" value="setext" />
            </el-select>
          </el-form-item>
          <el-form-item label="Tab size">
            <el-input-number
              :model-value="prefs.tabSize"
              :min="1"
              :max="8"
              @update:model-value="v => prefs.set('tabSize', Number(v))"
            />
          </el-form-item>
          <el-form-item label="List indentation">
            <el-select
              :model-value="prefs.listIndentation"
              style="width: 200px"
              @update:model-value="v => prefs.set('listIndentation', v as never)"
            >
              <el-option label="DFM" value="dfm" />
              <el-option label="Tab" value="tab" />
              <el-option label="1 space" :value="1" />
              <el-option label="2 spaces" :value="2" />
              <el-option label="3 spaces" :value="3" />
              <el-option label="4 spaces" :value="4" />
            </el-select>
          </el-form-item>
          <el-form-item label="Frontmatter type">
            <el-select
              :model-value="prefs.frontmatterType"
              style="width: 200px"
              @update:model-value="v => prefs.set('frontmatterType', v as '-' | '+' | ';' | '{')"
            >
              <el-option label="YAML (---)" value="-" />
              <el-option label="TOML (+++)" value="+" />
              <el-option label="JSON ({})" value="{" />
              <el-option label="ezhil (;;;)" value=";" />
            </el-select>
          </el-form-item>
          <el-form-item label="Sequence diagram theme">
            <el-select
              :model-value="prefs.sequenceTheme"
              style="width: 200px"
              @update:model-value="v => prefs.set('sequenceTheme', String(v))"
            >
              <el-option label="Hand" value="hand" />
              <el-option label="Simple" value="simple" />
            </el-select>
          </el-form-item>
          <el-form-item label="Superscript / Subscript">
            <el-switch :model-value="prefs.superSubScript" @update:model-value="v => prefs.set('superSubScript', !!v)" />
          </el-form-item>
          <el-form-item label="Footnote">
            <el-switch :model-value="prefs.footnote" @update:model-value="v => prefs.set('footnote', !!v)" />
          </el-form-item>
          <el-form-item label="Allow inline HTML">
            <el-switch :model-value="prefs.isHtmlEnabled" @update:model-value="v => prefs.set('isHtmlEnabled', !!v)" />
          </el-form-item>
          <el-form-item label="GitLab compatibility">
            <el-switch :model-value="prefs.isGitlabCompatibilityEnabled" @update:model-value="v => prefs.set('isGitlabCompatibilityEnabled', !!v)" />
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Theme ──────────────────────────────────────── -->
      <section v-show="active === 'theme'" class="prefs-section">
        <h3>Theme</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item label="Theme">
            <el-select
              :model-value="prefs.theme"
              style="width: 240px"
              @update:model-value="v => prefs.set('theme', v as string)"
            >
              <el-option-group label="Built-in">
                <el-option label="Light" value="light" />
                <el-option label="Dark" value="dark" />
                <el-option label="GitHub Blue" value="github-blue" />
                <el-option label="Graphite Light" value="graphite-light" />
                <el-option label="Material Dark" value="material-dark" />
                <el-option label="One Dark" value="one-dark" />
                <el-option label="Ulysses Light" value="ulysses-light" />
              </el-option-group>
              <el-option-group v-if="userThemes.length" label="User themes">
                <el-option
                  v-for="ut in userThemes"
                  :key="ut.id"
                  :label="ut.name"
                  :value="ut.id"
                />
              </el-option-group>
            </el-select>
            <el-button size="small" link style="margin-left: 12px" @click="reloadUserThemes">
              Refresh user themes
            </el-button>
          </el-form-item>
          <el-form-item label="Auto-switch theme">
            <el-select
              :model-value="prefs.autoSwitchTheme"
              style="width: 240px"
              @update:model-value="v => prefs.set('autoSwitchTheme', Number(v))"
            >
              <el-option label="Disabled" :value="0" />
              <el-option label="Follow OS" :value="1" />
              <el-option label="Use selected theme" :value="2" />
            </el-select>
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Image ──────────────────────────────────────── -->
      <section v-show="active === 'image'" class="prefs-section">
        <h3>Image</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item label="Insert action">
            <el-select
              :model-value="prefs.imageInsertAction"
              style="width: 220px"
              @update:model-value="v => prefs.set('imageInsertAction', v as 'upload' | 'folder' | 'path')"
            >
              <el-option label="Use absolute path" value="path" />
              <el-option label="Copy to image folder" value="folder" />
              <el-option label="Upload to remote" value="upload" />
            </el-select>
          </el-form-item>
          <el-form-item label="Prefer relative directory">
            <el-switch :model-value="prefs.imagePreferRelativeDirectory" @update:model-value="v => prefs.set('imagePreferRelativeDirectory', !!v)" />
          </el-form-item>
          <el-form-item label="Relative image folder name">
            <el-input
              :model-value="prefs.imageRelativeDirectoryName"
              style="width: 220px"
              @update:model-value="v => prefs.set('imageRelativeDirectoryName', String(v))"
            />
          </el-form-item>
          <el-form-item label="Image folder (absolute)">
            <el-input
              :model-value="prefs.imageFolderPath"
              style="width: 320px"
              @update:model-value="v => prefs.patchUserData({ imageFolderPath: String(v) })"
            />
          </el-form-item>
          <el-form-item label="Current uploader">
            <el-select
              :model-value="prefs.currentUploader"
              style="width: 220px"
              @update:model-value="v => prefs.patchUserData({ currentUploader: v as 'none' | 'github' | 's3' })"
            >
              <el-option label="None" value="none" />
              <el-option label="GitHub" value="github" />
              <el-option label="S3" value="s3" />
            </el-select>
          </el-form-item>
          <el-form-item v-show="prefs.currentUploader === 'github'" label="GitHub token">
            <el-input
              :model-value="prefs.githubToken"
              type="password"
              show-password
              style="width: 320px"
              @update:model-value="v => prefs.patchUserData({ githubToken: String(v) })"
            />
          </el-form-item>
          <el-form-item v-show="prefs.currentUploader === 'github'" label="GitHub owner">
            <el-input
              :model-value="prefs.imageBed.github.owner"
              style="width: 220px"
              @update:model-value="v => prefs.patchUserData({ imageBed: { github: { ...prefs.imageBed.github, owner: String(v) } } })"
            />
          </el-form-item>
          <el-form-item v-show="prefs.currentUploader === 'github'" label="GitHub repo">
            <el-input
              :model-value="prefs.imageBed.github.repo"
              style="width: 220px"
              @update:model-value="v => prefs.patchUserData({ imageBed: { github: { ...prefs.imageBed.github, repo: String(v) } } })"
            />
          </el-form-item>
          <el-form-item v-show="prefs.currentUploader === 'github'" label="GitHub branch">
            <el-input
              :model-value="prefs.imageBed.github.branch"
              placeholder="main"
              style="width: 220px"
              @update:model-value="v => prefs.patchUserData({ imageBed: { github: { ...prefs.imageBed.github, branch: String(v) } } })"
            />
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Spellchecker ───────────────────────────────── -->
      <section v-show="active === 'spellchecker'" class="prefs-section">
        <h3>Spellchecker</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item label="Enable spellchecker">
            <el-switch :model-value="prefs.spellcheckerEnabled" @update:model-value="v => prefs.set('spellcheckerEnabled', !!v)" />
          </el-form-item>
          <el-form-item label="Don't underline mistakes">
            <el-switch :model-value="prefs.spellcheckerNoUnderline" @update:model-value="v => prefs.set('spellcheckerNoUnderline', !!v)" />
          </el-form-item>
          <el-form-item label="Language">
            <el-input
              :model-value="prefs.spellcheckerLanguage"
              placeholder="en-US"
              style="width: 220px"
              @update:model-value="v => prefs.set('spellcheckerLanguage', String(v))"
            />
          </el-form-item>
          <el-alert type="info" :closable="false" show-icon>
            Spellchecker dictionaries are loaded via the Rust backend
            (<code>cmd_spellcheck_available_dictionaries</code>). Hunspell
            integration is stubbed pending Phase 7.
          </el-alert>
        </el-form>
      </section>

      <!-- ── View ───────────────────────────────────────── -->
      <section v-show="active === 'view'" class="prefs-section">
        <h3>View</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item label="Sidebar visible by default">
            <el-switch :model-value="prefs.sideBarVisibility" @update:model-value="v => prefs.set('sideBarVisibility', !!v)" />
          </el-form-item>
          <el-form-item label="Tab bar visible by default">
            <el-switch :model-value="prefs.tabBarVisibility" @update:model-value="v => prefs.set('tabBarVisibility', !!v)" />
          </el-form-item>
          <el-form-item label="Start in source-code mode">
            <el-switch :model-value="prefs.sourceCodeModeEnabled" @update:model-value="v => prefs.set('sourceCodeModeEnabled', !!v)" />
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Search ─────────────────────────────────────── -->
      <section v-show="active === 'search'" class="prefs-section">
        <h3>Search</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item label="Exclusions (glob patterns)">
            <el-input
              type="textarea"
              :rows="4"
              :model-value="prefs.searchExclusions.join('\n')"
              placeholder="**/node_modules/**&#10;**/.git/**"
              style="width: 360px"
              @update:model-value="v => prefs.set('searchExclusions', String(v).split(/\r?\n/).map(s => s.trim()).filter(Boolean))"
            />
          </el-form-item>
          <el-form-item label="Max file size (e.g. 1M)">
            <el-input
              :model-value="prefs.searchMaxFileSize"
              style="width: 200px"
              @update:model-value="v => prefs.set('searchMaxFileSize', String(v))"
            />
          </el-form-item>
          <el-form-item label="Include hidden files">
            <el-switch :model-value="prefs.searchIncludeHidden" @update:model-value="v => prefs.set('searchIncludeHidden', !!v)" />
          </el-form-item>
          <el-form-item label="Disregard ignore files">
            <el-switch :model-value="prefs.searchNoIgnore" @update:model-value="v => prefs.set('searchNoIgnore', !!v)" />
          </el-form-item>
          <el-form-item label="Follow symlinks">
            <el-switch :model-value="prefs.searchFollowSymlinks" @update:model-value="v => prefs.set('searchFollowSymlinks', !!v)" />
          </el-form-item>
          <el-form-item label="Watcher uses polling">
            <el-switch :model-value="prefs.watcherUsePolling" @update:model-value="v => prefs.set('watcherUsePolling', !!v)" />
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Keybindings ────────────────────────────────── -->
      <section v-show="active === 'keybindings'" class="prefs-section">
        <h3>Keybindings</h3>
        <p class="hint">Click a binding to record a new shortcut. Press Esc to cancel.</p>
        <table class="kb-table">
          <thead>
            <tr><th>Action</th><th>Shortcut</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="(accel, id) in keys.map" :key="id">
              <td class="kb-id">{{ id }}</td>
              <td class="kb-accel">
                <button
                  v-if="editingAccel !== id"
                  class="kb-button"
                  @click="startEdit(id)"
                >
{{ accel || '—' }}
</button>
                <input
                  v-else
                  type="text"
                  class="kb-input"
                  autofocus
                  :value="recordedAccel || 'Press keys…'"
                  readonly
                  @keydown="onAccelKey"
                  @blur="cancelEdit"
                />
              </td>
              <td>
                <template v-if="editingAccel === id">
                  <el-button size="small" type="primary" :disabled="!recordedAccel" @click="applyAccel">Set</el-button>
                  <el-button size="small" @click="cancelEdit">Cancel</el-button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <el-button size="small" style="margin-top: 16px" @click="keys.resetAll()">Reset all to defaults</el-button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.prefs-page {
  display: flex;
  height: 100%;
  background: var(--mt-bg, #fff);
  color: var(--mt-fg, #24292e);
}
.prefs-nav {
  width: 180px;
  border-right: 1px solid var(--mt-border, #eaecef);
  background: var(--mt-sidebar-bg, #fafbfc);
  padding: 20px 0;
  flex-shrink: 0;
}
.prefs-title {
  margin: 0 0 16px 20px;
  font-size: 16px;
  font-weight: 600;
}
.prefs-nav ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.prefs-nav li {
  padding: 8px 20px;
  font-size: 13px;
  cursor: pointer;
  color: var(--mt-fg-muted, #586069);
}
.prefs-nav li:hover { background: var(--mt-row-hover, #ebedef); }
.prefs-nav li.active {
  background: var(--mt-row-active, #fff);
  color: var(--mt-accent, #0366d6);
  border-left: 3px solid var(--mt-accent, #0366d6);
  padding-left: 17px;
  font-weight: 500;
}
.prefs-body {
  flex: 1;
  overflow: auto;
  padding: 28px 36px;
}
.prefs-section h3 {
  margin: 0 0 24px;
  font-size: 18px;
  font-weight: 600;
  border-bottom: 1px solid var(--mt-border, #eaecef);
  padding-bottom: 12px;
}
.prefs-section :deep(.el-form-item) {
  margin-bottom: 18px;
}
.hint {
  color: var(--mt-fg-muted, #6a737d);
  font-size: 12px;
  margin: -12px 0 16px;
}
.kb-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.kb-table th, .kb-table td {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--mt-border, #eaecef);
}
.kb-table th {
  font-weight: 600;
  color: var(--mt-fg-muted, #586069);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.kb-id { font-family: ui-monospace, monospace; font-size: 12px; color: var(--mt-fg, #24292e); }
.kb-button, .kb-input {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--mt-border, #d1d5da);
  border-radius: 4px;
  background: var(--mt-tab-bg, #f5f6f7);
  color: var(--mt-fg, #24292e);
  cursor: pointer;
  min-width: 160px;
}
.kb-button:hover { background: var(--mt-row-hover, #ebedef); }
.kb-input { background: #fff8dc; cursor: text; }
.icon-choices {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.icon-choice {
  width: 128px;
  min-height: 142px;
  padding: 12px;
  border: 1px solid var(--mt-border, #d1d5da);
  border-radius: 8px;
  background: var(--mt-tab-bg, #f5f6f7);
  color: var(--mt-fg, #24292e);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.icon-choice:hover { background: var(--mt-row-hover, #ebedef); }
.icon-choice.selected {
  border-color: var(--mt-accent, #0366d6);
  box-shadow: 0 0 0 2px rgba(3, 102, 214, 0.16);
  background: var(--mt-row-active, #fff);
}
.icon-choice img {
  width: 72px;
  height: 72px;
  object-fit: contain;
  flex-shrink: 0;
}
.icon-choice-title { font-size: 13px; font-weight: 600; line-height: 1.2; }
.icon-choice-desc {
  font-size: 11px;
  color: var(--mt-fg-muted, #586069);
  line-height: 1.2;
  text-align: center;
}

</style>
