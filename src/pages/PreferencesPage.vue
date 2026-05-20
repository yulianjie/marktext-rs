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
import { useI18n } from '@/i18n'

const prefs = usePreferencesStore()
const listener = useListenForMainStore()
const keys = useKeybindingsStore()
const userThemes = ref<UserTheme[]>([])
const { t } = useI18n()

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

const sections = computed<{ id: SectionId; label: string }[]>(() => [
  { id: 'general', label: t('prefs.sections.general') },
  { id: 'editor', label: t('prefs.sections.editor') },
  { id: 'markdown', label: t('prefs.sections.markdown') },
  { id: 'theme', label: t('prefs.sections.theme') },
  { id: 'image', label: t('prefs.sections.image') },
  { id: 'spellchecker', label: t('prefs.sections.spellchecker') },
  { id: 'view', label: t('prefs.sections.view') },
  { id: 'search', label: t('prefs.sections.search') },
  { id: 'keybindings', label: t('prefs.sections.keybindings') },
])

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
      <h2 class="prefs-title">{{ t('prefs.title') }}</h2>
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
        <h3>{{ t('prefs.sections.general') }}</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item :label="t('prefs.general.autoSave')">
            <el-switch :model-value="prefs.autoSave" @update:model-value="v => prefs.set('autoSave', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.general.autoSaveDelay')">
            <el-input-number
              :model-value="prefs.autoSaveDelay"
              :min="1000"
              :step="500"
              @update:model-value="v => prefs.set('autoSaveDelay', Number(v))"
            />
          </el-form-item>
          <el-form-item :label="t('prefs.general.titleBarStyle')">
            <el-select
              :model-value="prefs.titleBarStyle"
              style="width: 200px"
              @update:model-value="v => prefs.set('titleBarStyle', v as 'custom' | 'native')"
            >
              <el-option :label="t('prefs.general.titleBarStyleCustom')" value="custom" />
              <el-option :label="t('prefs.general.titleBarStyleNative')" value="native" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('prefs.general.rememberWindowSize')">
            <el-switch
              :model-value="prefs.rememberWindowSize"
              @update:model-value="v => prefs.set('rememberWindowSize', !!v)"
            />
            <span class="hint inline-hint">
              {{ t('prefs.general.rememberWindowSizeHint') }}
            </span>
          </el-form-item>
          <el-form-item :label="t('prefs.general.appIcon')">
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
          <el-form-item :label="t('prefs.general.openFilesNewWindow')">
            <el-switch :model-value="prefs.openFilesInNewWindow" @update:model-value="v => prefs.set('openFilesInNewWindow', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.general.openFolderNewWindow')">
            <el-switch :model-value="prefs.openFolderInNewWindow" @update:model-value="v => prefs.set('openFolderInNewWindow', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.general.zoom')">
            <el-slider
              :model-value="prefs.zoom"
              :min="0.5"
              :max="2.0"
              :step="0.1"
              style="width: 220px"
              @update:model-value="v => prefs.set('zoom', Number(v))"
            />
          </el-form-item>
          <el-form-item :label="t('prefs.general.hideScrollbar')">
            <el-switch :model-value="prefs.hideScrollbar" @update:model-value="v => prefs.set('hideScrollbar', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.general.wordWrapInToc')">
            <el-switch :model-value="prefs.wordWrapInToc" @update:model-value="v => prefs.set('wordWrapInToc', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.general.sortBy')">
            <el-select
              :model-value="prefs.fileSortBy"
              style="width: 200px"
              @update:model-value="v => prefs.set('fileSortBy', v as 'created' | 'modified' | 'title')"
            >
              <el-option :label="t('prefs.general.sortByModified')" value="modified" />
              <el-option :label="t('prefs.general.sortByCreated')" value="created" />
              <el-option :label="t('prefs.general.sortByTitle')" value="title" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('prefs.general.onStartup')">
            <el-select
              :model-value="prefs.startUpAction"
              style="width: 200px"
              @update:model-value="v => prefs.set('startUpAction', v as 'folder' | 'lastState' | 'blank')"
            >
              <el-option :label="t('prefs.general.startupBlank')" value="blank" />
              <el-option :label="t('prefs.general.startupLastState')" value="lastState" />
              <el-option :label="t('prefs.general.startupFolder')" value="folder" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('prefs.general.language')">
            <el-select
              :model-value="prefs.language"
              style="width: 200px"
              @update:model-value="v => prefs.set('language', v as string)"
            >
              <el-option label="English" value="en" />
              <el-option label="简体中文" value="zh-CN" />
              <el-option label="日本語" value="ja" />
            </el-select>
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Editor ─────────────────────────────────────── -->
      <section v-show="active === 'editor'" class="prefs-section">
        <h3>{{ t('prefs.sections.editor') }}</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item :label="t('prefs.editor.fontSize')">
            <el-input-number v-model="fontSize" :min="12" :max="32" />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.lineHeight')">
            <el-input-number
              :model-value="prefs.lineHeight"
              :min="1.2"
              :max="2"
              :step="0.1"
              :precision="1"
              @update:model-value="v => prefs.set('lineHeight', Number(v))"
            />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.fontFamily')">
            <el-input
              :model-value="prefs.editorFontFamily"
              style="width: 240px"
              @update:model-value="v => prefs.set('editorFontFamily', String(v))"
            />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.lineWidth')">
            <el-input
              :model-value="prefs.editorLineWidth"
              :placeholder="t('prefs.editor.lineWidthPlaceholder')"
              style="width: 200px"
              @update:model-value="v => prefs.set('editorLineWidth', String(v))"
            />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.codeFontSize')">
            <el-input-number
              :model-value="prefs.codeFontSize"
              :min="12"
              :max="28"
              @update:model-value="v => prefs.set('codeFontSize', Number(v))"
            />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.codeFontFamily')">
            <el-input
              :model-value="prefs.codeFontFamily"
              style="width: 240px"
              @update:model-value="v => prefs.set('codeFontFamily', String(v))"
            />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.codeLineNumbers')">
            <el-switch :model-value="prefs.codeBlockLineNumbers" @update:model-value="v => prefs.set('codeBlockLineNumbers', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.trimEmpty')">
            <el-switch :model-value="prefs.trimUnnecessaryCodeBlockEmptyLines" @update:model-value="v => prefs.set('trimUnnecessaryCodeBlockEmptyLines', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.autoPairBracket')">
            <el-switch :model-value="prefs.autoPairBracket" @update:model-value="v => prefs.set('autoPairBracket', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.autoPairMd')">
            <el-switch :model-value="prefs.autoPairMarkdownSyntax" @update:model-value="v => prefs.set('autoPairMarkdownSyntax', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.autoPairQuote')">
            <el-switch :model-value="prefs.autoPairQuote" @update:model-value="v => prefs.set('autoPairQuote', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.eol')">
            <el-select
              :model-value="prefs.endOfLine"
              style="width: 200px"
              @update:model-value="v => prefs.set('endOfLine', v as 'default' | 'lf' | 'crlf')"
            >
              <el-option :label="t('prefs.editor.eolDefault')" value="default" />
              <el-option :label="t('prefs.editor.eolLf')" value="lf" />
              <el-option :label="t('prefs.editor.eolCrlf')" value="crlf" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('prefs.editor.encoding')">
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
          <el-form-item :label="t('prefs.editor.autoGuessEncoding')">
            <el-switch :model-value="prefs.autoGuessEncoding" @update:model-value="v => prefs.set('autoGuessEncoding', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.textDirection')">
            <el-select
              :model-value="prefs.textDirection"
              style="width: 200px"
              @update:model-value="v => prefs.set('textDirection', v as 'ltr' | 'rtl')"
            >
              <el-option :label="t('prefs.editor.textDirectionLtr')" value="ltr" />
              <el-option :label="t('prefs.editor.textDirectionRtl')" value="rtl" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('prefs.editor.hideQuickInsert')">
            <el-switch :model-value="prefs.hideQuickInsertHint" @update:model-value="v => prefs.set('hideQuickInsertHint', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.hideLinkPopup')">
            <el-switch :model-value="prefs.hideLinkPopup" @update:model-value="v => prefs.set('hideLinkPopup', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.editor.autoCheck')">
            <el-switch :model-value="prefs.autoCheck" @update:model-value="v => prefs.set('autoCheck', !!v)" />
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Markdown ───────────────────────────────────── -->
      <section v-show="active === 'markdown'" class="prefs-section">
        <h3>{{ t('prefs.sections.markdown') }}</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item :label="t('prefs.markdown.preferLooseListItem')">
            <el-switch :model-value="prefs.preferLooseListItem" @update:model-value="v => prefs.set('preferLooseListItem', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.markdown.bulletListMarker')">
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
          <el-form-item :label="t('prefs.markdown.orderListDelimiter')">
            <el-select
              :model-value="prefs.orderListDelimiter"
              style="width: 120px"
              @update:model-value="v => prefs.set('orderListDelimiter', v as '.' | ')')"
            >
              <el-option label="." value="." />
              <el-option label=")" value=")" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('prefs.markdown.preferHeadingStyle')">
            <el-select
              :model-value="prefs.preferHeadingStyle"
              style="width: 200px"
              @update:model-value="v => prefs.set('preferHeadingStyle', v as 'atx' | 'setext')"
            >
              <el-option :label="t('prefs.markdown.headingAtx')" value="atx" />
              <el-option :label="t('prefs.markdown.headingSetext')" value="setext" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('prefs.markdown.tabSize')">
            <el-input-number
              :model-value="prefs.tabSize"
              :min="1"
              :max="8"
              @update:model-value="v => prefs.set('tabSize', Number(v))"
            />
          </el-form-item>
          <el-form-item :label="t('prefs.markdown.listIndentation')">
            <el-select
              :model-value="prefs.listIndentation"
              style="width: 200px"
              @update:model-value="v => prefs.set('listIndentation', v as never)"
            >
              <el-option :label="t('prefs.markdown.listIndentDfm')" value="dfm" />
              <el-option :label="t('prefs.markdown.listIndentTab')" value="tab" />
              <el-option :label="t('prefs.markdown.listIndent1')" :value="1" />
              <el-option :label="t('prefs.markdown.listIndent2')" :value="2" />
              <el-option :label="t('prefs.markdown.listIndent3')" :value="3" />
              <el-option :label="t('prefs.markdown.listIndent4')" :value="4" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('prefs.markdown.frontmatterType')">
            <el-select
              :model-value="prefs.frontmatterType"
              style="width: 200px"
              @update:model-value="v => prefs.set('frontmatterType', v as '-' | '+' | ';' | '{')"
            >
              <el-option :label="t('prefs.markdown.frontmatterYaml')" value="-" />
              <el-option :label="t('prefs.markdown.frontmatterToml')" value="+" />
              <el-option :label="t('prefs.markdown.frontmatterJson')" value="{" />
              <el-option :label="t('prefs.markdown.frontmatterEzhil')" value=";" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('prefs.markdown.sequenceTheme')">
            <el-select
              :model-value="prefs.sequenceTheme"
              style="width: 200px"
              @update:model-value="v => prefs.set('sequenceTheme', String(v))"
            >
              <el-option :label="t('prefs.markdown.sequenceHand')" value="hand" />
              <el-option :label="t('prefs.markdown.sequenceSimple')" value="simple" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('prefs.markdown.superSubScript')">
            <el-switch :model-value="prefs.superSubScript" @update:model-value="v => prefs.set('superSubScript', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.markdown.footnote')">
            <el-switch :model-value="prefs.footnote" @update:model-value="v => prefs.set('footnote', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.markdown.isHtmlEnabled')">
            <el-switch :model-value="prefs.isHtmlEnabled" @update:model-value="v => prefs.set('isHtmlEnabled', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.markdown.isGitlabCompatibilityEnabled')">
            <el-switch :model-value="prefs.isGitlabCompatibilityEnabled" @update:model-value="v => prefs.set('isGitlabCompatibilityEnabled', !!v)" />
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Theme ──────────────────────────────────────── -->
      <section v-show="active === 'theme'" class="prefs-section">
        <h3>{{ t('prefs.sections.theme') }}</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item :label="t('prefs.theme.theme')">
            <el-select
              :model-value="prefs.theme"
              style="width: 240px"
              @update:model-value="v => prefs.set('theme', v as string)"
            >
              <el-option-group :label="t('prefs.theme.groupBuiltin')">
                <el-option :label="t('prefs.theme.themeLight')" value="light" />
                <el-option :label="t('prefs.theme.themeDark')" value="dark" />
                <el-option :label="t('prefs.theme.themeGithubBlue')" value="github-blue" />
                <el-option :label="t('prefs.theme.themeGraphiteLight')" value="graphite-light" />
                <el-option :label="t('prefs.theme.themeMaterialDark')" value="material-dark" />
                <el-option :label="t('prefs.theme.themeOneDark')" value="one-dark" />
                <el-option :label="t('prefs.theme.themeUlyssesLight')" value="ulysses-light" />
              </el-option-group>
              <el-option-group v-if="userThemes.length" :label="t('prefs.theme.groupUser')">
                <el-option
                  v-for="ut in userThemes"
                  :key="ut.id"
                  :label="ut.name"
                  :value="ut.id"
                />
              </el-option-group>
            </el-select>
            <el-button size="small" link style="margin-left: 12px" @click="reloadUserThemes">
              {{ t('prefs.theme.refreshUserThemes') }}
            </el-button>
          </el-form-item>
          <el-form-item :label="t('prefs.theme.autoSwitch')">
            <el-select
              :model-value="prefs.autoSwitchTheme"
              style="width: 240px"
              @update:model-value="v => prefs.set('autoSwitchTheme', Number(v))"
            >
              <el-option :label="t('prefs.theme.autoSwitchDisabled')" :value="0" />
              <el-option :label="t('prefs.theme.autoSwitchFollowOs')" :value="1" />
              <el-option :label="t('prefs.theme.autoSwitchUseSelected')" :value="2" />
            </el-select>
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Image ──────────────────────────────────────── -->
      <section v-show="active === 'image'" class="prefs-section">
        <h3>{{ t('prefs.sections.image') }}</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item :label="t('prefs.image.insertAction')">
            <el-select
              :model-value="prefs.imageInsertAction"
              style="width: 220px"
              @update:model-value="v => prefs.set('imageInsertAction', v as 'upload' | 'folder' | 'path')"
            >
              <el-option :label="t('prefs.image.insertActionPath')" value="path" />
              <el-option :label="t('prefs.image.insertActionFolder')" value="folder" />
              <el-option :label="t('prefs.image.insertActionUpload')" value="upload" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('prefs.image.preferRelativeDirectory')">
            <el-switch :model-value="prefs.imagePreferRelativeDirectory" @update:model-value="v => prefs.set('imagePreferRelativeDirectory', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.image.relativeDirectoryName')">
            <el-input
              :model-value="prefs.imageRelativeDirectoryName"
              style="width: 220px"
              @update:model-value="v => prefs.set('imageRelativeDirectoryName', String(v))"
            />
          </el-form-item>
          <el-form-item :label="t('prefs.image.folderAbsolute')">
            <el-input
              :model-value="prefs.imageFolderPath"
              style="width: 320px"
              @update:model-value="v => prefs.patchUserData({ imageFolderPath: String(v) })"
            />
          </el-form-item>
          <el-form-item :label="t('prefs.image.currentUploader')">
            <el-select
              :model-value="prefs.currentUploader"
              style="width: 220px"
              @update:model-value="v => prefs.patchUserData({ currentUploader: v as 'none' | 'github' | 's3' })"
            >
              <el-option :label="t('prefs.image.uploaderNone')" value="none" />
              <el-option :label="t('prefs.image.uploaderGithub')" value="github" />
              <el-option :label="t('prefs.image.uploaderS3')" value="s3" />
            </el-select>
          </el-form-item>
          <el-form-item v-show="prefs.currentUploader === 'github'" :label="t('prefs.image.githubToken')">
            <el-input
              :model-value="prefs.githubToken"
              type="password"
              show-password
              style="width: 320px"
              @update:model-value="v => prefs.patchUserData({ githubToken: String(v) })"
            />
          </el-form-item>
          <el-form-item v-show="prefs.currentUploader === 'github'" :label="t('prefs.image.githubOwner')">
            <el-input
              :model-value="prefs.imageBed.github.owner"
              style="width: 220px"
              @update:model-value="v => prefs.patchUserData({ imageBed: { github: { ...prefs.imageBed.github, owner: String(v) } } })"
            />
          </el-form-item>
          <el-form-item v-show="prefs.currentUploader === 'github'" :label="t('prefs.image.githubRepo')">
            <el-input
              :model-value="prefs.imageBed.github.repo"
              style="width: 220px"
              @update:model-value="v => prefs.patchUserData({ imageBed: { github: { ...prefs.imageBed.github, repo: String(v) } } })"
            />
          </el-form-item>
          <el-form-item v-show="prefs.currentUploader === 'github'" :label="t('prefs.image.githubBranch')">
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
        <h3>{{ t('prefs.sections.spellchecker') }}</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item :label="t('prefs.spellchecker.enabled')">
            <el-switch :model-value="prefs.spellcheckerEnabled" @update:model-value="v => prefs.set('spellcheckerEnabled', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.spellchecker.noUnderline')">
            <el-switch :model-value="prefs.spellcheckerNoUnderline" @update:model-value="v => prefs.set('spellcheckerNoUnderline', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.spellchecker.language')">
            <el-input
              :model-value="prefs.spellcheckerLanguage"
              :placeholder="t('prefs.spellchecker.languagePlaceholder')"
              style="width: 220px"
              @update:model-value="v => prefs.set('spellcheckerLanguage', String(v))"
            />
          </el-form-item>
          <el-alert type="info" :closable="false" show-icon>
            {{ t('prefs.spellchecker.info', { cmd: 'cmd_spellcheck_available_dictionaries' }) }}
          </el-alert>
        </el-form>
      </section>

      <!-- ── View ───────────────────────────────────────── -->
      <section v-show="active === 'view'" class="prefs-section">
        <h3>{{ t('prefs.sections.view') }}</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item :label="t('prefs.view.sidebarVisibility')">
            <el-switch :model-value="prefs.sideBarVisibility" @update:model-value="v => prefs.set('sideBarVisibility', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.view.tabBarVisibility')">
            <el-switch :model-value="prefs.tabBarVisibility" @update:model-value="v => prefs.set('tabBarVisibility', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.view.sourceCodeMode')">
            <el-switch :model-value="prefs.sourceCodeModeEnabled" @update:model-value="v => prefs.set('sourceCodeModeEnabled', !!v)" />
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Search ─────────────────────────────────────── -->
      <section v-show="active === 'search'" class="prefs-section">
        <h3>{{ t('prefs.sections.search') }}</h3>
        <el-form label-width="220px" label-position="left">
          <el-form-item :label="t('prefs.search.exclusions')">
            <el-input
              type="textarea"
              :rows="4"
              :model-value="prefs.searchExclusions.join('\n')"
              placeholder="**/node_modules/**&#10;**/.git/**"
              style="width: 360px"
              @update:model-value="v => prefs.set('searchExclusions', String(v).split(/\r?\n/).map(s => s.trim()).filter(Boolean))"
            />
          </el-form-item>
          <el-form-item :label="t('prefs.search.maxFileSize')">
            <el-input
              :model-value="prefs.searchMaxFileSize"
              style="width: 200px"
              @update:model-value="v => prefs.set('searchMaxFileSize', String(v))"
            />
          </el-form-item>
          <el-form-item :label="t('prefs.search.includeHidden')">
            <el-switch :model-value="prefs.searchIncludeHidden" @update:model-value="v => prefs.set('searchIncludeHidden', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.search.noIgnore')">
            <el-switch :model-value="prefs.searchNoIgnore" @update:model-value="v => prefs.set('searchNoIgnore', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.search.followSymlinks')">
            <el-switch :model-value="prefs.searchFollowSymlinks" @update:model-value="v => prefs.set('searchFollowSymlinks', !!v)" />
          </el-form-item>
          <el-form-item :label="t('prefs.search.watcherUsePolling')">
            <el-switch :model-value="prefs.watcherUsePolling" @update:model-value="v => prefs.set('watcherUsePolling', !!v)" />
          </el-form-item>
        </el-form>
      </section>

      <!-- ── Keybindings ────────────────────────────────── -->
      <section v-show="active === 'keybindings'" class="prefs-section">
        <h3>{{ t('prefs.sections.keybindings') }}</h3>
        <p class="hint">{{ t('prefs.keybindings.hint') }}</p>
        <table class="kb-table">
          <thead>
            <tr><th>{{ t('prefs.keybindings.action') }}</th><th>{{ t('prefs.keybindings.shortcut') }}</th><th></th></tr>
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
                  :value="recordedAccel || t('prefs.keybindings.pressKeys')"
                  readonly
                  @keydown="onAccelKey"
                  @blur="cancelEdit"
                />
              </td>
              <td>
                <template v-if="editingAccel === id">
                  <el-button size="small" type="primary" :disabled="!recordedAccel" @click="applyAccel">{{ t('common.set') }}</el-button>
                  <el-button size="small" @click="cancelEdit">{{ t('common.cancel') }}</el-button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <el-button size="small" style="margin-top: 16px" @click="keys.resetAll()">{{ t('prefs.keybindings.resetAll') }}</el-button>
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
.inline-hint {
  margin: 0 0 0 12px;
  display: inline-block;
  max-width: 360px;
  line-height: 1.4;
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
