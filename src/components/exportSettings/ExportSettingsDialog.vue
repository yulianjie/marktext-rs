<script setup lang="ts">
/**
 * Export settings dialog — replaces the upstream
 * `src/renderer/components/exportSettings/` Vue 2 dialog.
 *
 * Opens on `bus.emit('show-export-dialog')`. Currently surfaces the knobs
 * we know how to honour:
 *   - Format: PDF (via Pandoc) | Styled HTML
 *   - Paper size + orientation (PDF only — wkhtmltopdf / xelatex understand
 *     `-V papersize:` and `-V geometry:landscape`)
 *   - Include title / TOC
 *
 * Falls back to `window.print()` when the user picks PDF but Pandoc is not
 * on PATH (the Pandoc call returns an error and we toast it).
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { bus } from '@/bus'
import { useI18n } from '@/i18n'
import { useEditorStore } from '@/stores/editor'
import { useNotificationStore } from '@/stores/notification'
import { saveAsDialog, exportHtml, pandocPdfExport } from '@/services/tauri-invoke'

const { t } = useI18n()
const editor = useEditorStore()
const notify = useNotificationStore()

const visible = ref(false)
const format = ref<'pdf' | 'html'>('pdf')
const paperSize = ref<'A4' | 'A5' | 'Letter' | 'Legal'>('A4')
const orientation = ref<'portrait' | 'landscape'>('portrait')
const includeTitle = ref(true)
const enableToc = ref(false)

function open() {
  visible.value = true
}

async function doExport() {
  const tab = editor.currentFile
  if (!tab) {
    visible.value = false
    return
  }
  const ext = format.value === 'pdf' ? 'pdf' : 'html'
  const base = tab.filename.replace(/\.md$/i, '') || 'untitled'
  const target = await saveAsDialog(`${base}.${ext}`)
  if (!target) return
  visible.value = false
  try {
    if (format.value === 'pdf') {
      await pandocPdfExport(tab.markdown, target, {
        paperSize: paperSize.value,
        orientation: orientation.value,
        title: includeTitle.value ? base : undefined,
        toc: enableToc.value,
      })
    } else {
      const muya = editor.getMuyaInstance()
      if (!muya) throw new Error(t('toast.editorNotReady'))
      const { default: ExportHtml } = await import('muya/lib/utils/exportHtml')
      const exporter = new ExportHtml(tab.markdown, muya)
      const html = await exporter.generate({
        title: includeTitle.value ? base : '',
        toc: enableToc.value,
        printOptimization: true,
        extraCss: '',
      })
      await exportHtml(target, html)
    }
    notify.pushToast({ type: 'success', message: t('toast.exportedTo', { path: target }) })
  } catch (err) {
    notify.pushToast({
      type: 'error',
      title: t('toast.exportFailed'),
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

let unsub: (() => void) | null = null
onMounted(() => { unsub = bus.on('show-export-dialog', open) })
onBeforeUnmount(() => { unsub?.() })
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('exportSettings.title')"
    width="420px"
    :close-on-click-modal="false"
    append-to-body
  >
    <el-form label-position="left" label-width="140px">
      <el-form-item :label="t('exportSettings.format')">
        <el-radio-group v-model="format">
          <el-radio value="pdf">{{ t('exportSettings.formatPdf') }}</el-radio>
          <el-radio value="html">{{ t('exportSettings.formatHtmlStyled') }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="format === 'pdf'" :label="t('exportSettings.paperSize')">
        <el-select v-model="paperSize" style="width: 160px">
          <el-option label="A4" value="A4" />
          <el-option label="A5" value="A5" />
          <el-option label="Letter" value="Letter" />
          <el-option label="Legal" value="Legal" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="format === 'pdf'" :label="t('exportSettings.orientation')">
        <el-radio-group v-model="orientation">
          <el-radio value="portrait">{{ t('exportSettings.orientationPortrait') }}</el-radio>
          <el-radio value="landscape">{{ t('exportSettings.orientationLandscape') }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="t('exportSettings.includeTitle')">
        <el-switch v-model="includeTitle" />
      </el-form-item>
      <el-form-item :label="t('exportSettings.enableToc')">
        <el-switch v-model="enableToc" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" @click="doExport">{{ t('exportSettings.export') }}</el-button>
    </template>
  </el-dialog>
</template>
