<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, Check, Copy, FileText, LoaderCircle, Plus, RotateCcw, Settings2, Sparkles, Square, TextSelect, X } from '@lucide/vue'
import DOMPurify from 'dompurify'
import marked from 'muya/lib/parser/marked'
import { useAgentStore } from '@/stores/agent'
import { useEditorStore } from '@/stores/editor'
import { useI18n } from '@/i18n'
import AgentSettings from './AgentSettings.vue'
import './agent.css'

const agent = useAgentStore()
const editor = useEditorStore()
const { t } = useI18n()
const input = ref<HTMLTextAreaElement | null>(null)
const feed = ref<HTMLElement | null>(null)
const nearBottom = ref(true)
const copied = ref('')
let copyTimer: ReturnType<typeof setTimeout> | undefined
const panelWidth = ref(380)
const selected = computed(() => agent.selection?.tabId === editor.currentFileId ? agent.selection : null)
const needsKey = computed(() => agent.config && !agent.config.hasKey && !/^http:\/\/(localhost|127\.|\[::1\])/.test(agent.config.baseUrl))
const attachmentName = computed(() => {
  if (!agent.includeDocument || !editor.currentFile) return t('agent.noAttachment')
  return `${selected.value ? t('agent.selection') : t('agent.document')} · ${editor.currentFile.filename}`
})
const quickActions = ['polish', 'summarize', 'outline', 'continue'] as const
const renderedMessages = computed(() => agent.conversation.messages.map(message => ({
  ...message,
  html: DOMPurify.sanitize(marked(message.content || ''), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'],
    ALLOWED_ATTR: [],
  }),
})))

async function scrollBottom(force = false) {
  await nextTick()
  if (feed.value && (nearBottom.value || force)) feed.value.scrollTop = feed.value.scrollHeight
}
watch(() => agent.conversation.messages.map(m => m.content.length + m.tools.length + Number(Boolean(m.edit))).join(','), () => { void scrollBottom() })
watch(() => editor.currentFileId, () => { nearBottom.value = true; void scrollBottom(true) })
watch(() => agent.settingsOpen, open => { if (!open) void nextTick(() => input.value?.focus()) })
function onScroll() {
  if (feed.value) nearBottom.value = feed.value.scrollHeight - feed.value.scrollTop - feed.value.clientHeight < 64
}
function send() {
  nearBottom.value = true
  void agent.send()
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send() }
}
function quick(action: string) {
  agent.conversation.draft = t(`agent.prompts.${action}`)
  input.value?.focus()
}
async function copy(id: string, content: string) {
  try {
    if ('__TAURI_INTERNALS__' in window) {
      const clipboard = await import('@tauri-apps/plugin-clipboard-manager')
      await clipboard.writeText(content)
    } else await navigator.clipboard.writeText(content)
    copied.value = id
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = '' }, 2000)
  } catch { agent.error = t('agent.errors.copy') }
}
let resizeStart: { x: number; width: number } | null = null
function resize(event: PointerEvent) {
  if (!resizeStart) return
  panelWidth.value = Math.max(320, Math.min(560, resizeStart.width + resizeStart.x - event.clientX, window.innerWidth - 340))
}
function stopResize() {
  resizeStart = null
  window.removeEventListener('pointermove', resize)
  window.removeEventListener('pointerup', stopResize)
  try { localStorage.setItem('mt:agentWidth', String(panelWidth.value)) } catch { /* optional layout preference */ }
}
function startResize(event: PointerEvent) {
  event.preventDefault()
  resizeStart = { x: event.clientX, width: panelWidth.value }
  window.addEventListener('pointermove', resize)
  window.addEventListener('pointerup', stopResize, { once: true })
}
onMounted(() => {
  try { const width = Number(localStorage.getItem('mt:agentWidth')); if (width >= 320 && width <= 560) panelWidth.value = width } catch { /* optional preference */ }
  input.value?.focus()
  if (!agent.config) void agent.loadConfig()
})
onBeforeUnmount(() => { stopResize(); clearTimeout(copyTimer) })
</script>

<template>
  <aside id="agent-panel" class="agent-panel" :style="{ '--agent-width': panelWidth + 'px' }" :aria-label="t('agent.title')">
    <div class="agent-resize" role="separator" tabindex="0" aria-orientation="vertical" :aria-valuenow="panelWidth" :aria-valuemin="320" :aria-valuemax="560" :aria-label="t('agent.resize')"
      @pointerdown="startResize" @keydown.left.prevent="panelWidth = Math.min(560, panelWidth + 20)" @keydown.right.prevent="panelWidth = Math.max(320, panelWidth - 20)" />
    <header class="agent-header">
      <Sparkles :size="16" class="agent-mark" /><h2>{{ t('agent.title') }}</h2>
      <button type="button" :disabled="agent.busy || !agent.conversation.messages.length" :aria-label="t('agent.newChat')" :title="t('agent.newChat')" @click="agent.clear"><Plus :size="16" /></button>
      <button type="button" :aria-label="t('agent.settings.title')" :title="t('agent.settings.title')" :aria-pressed="agent.settingsOpen" @click="agent.settingsOpen = !agent.settingsOpen"><Settings2 :size="16" /></button>
      <button type="button" :aria-label="t('common.close')" :title="t('common.close')" @click="agent.visible = false"><X :size="16" /></button>
    </header>
    <AgentSettings v-if="agent.settingsOpen" />
    <template v-else>
      <div class="agent-model-row"><span :title="agent.config?.baseUrl">{{ agent.config?.model || t('agent.notConfigured') }}</span><span>{{ t('agent.reviewFirst') }}</span></div>
      <div v-if="agent.configError" class="agent-banner" role="alert">{{ agent.configError }}<button type="button" @click="agent.loadConfig">{{ t('agent.retry') }}</button></div>
      <div v-if="agent.busy && !agent.runningHere" class="agent-banner" role="status">{{ t('agent.runningElsewhere') }}<button type="button" @click="editor.setCurrent(agent.run!.key)">{{ t('agent.returnToRun') }}</button></div>
      <div ref="feed" class="agent-feed" role="log" :aria-label="t('agent.conversation')" aria-live="off" @scroll="onScroll">
        <section v-if="!agent.conversation.messages.length" class="agent-welcome">
          <div class="agent-welcome-mark"><Sparkles :size="25" :stroke-width="1.5" /></div>
          <h3>{{ t('agent.welcome') }}</h3><p>{{ t('agent.welcomeDetail') }}</p>
          <div class="agent-quick-actions"><button v-for="action in quickActions" :key="action" type="button" @click="quick(action)">{{ t(`agent.actions.${action}`) }}<ArrowUp :size="13" /></button></div>
          <button v-if="needsKey || !agent.config" type="button" class="agent-configure" @click="agent.settingsOpen = true"><Settings2 :size="14" />{{ t('agent.configure') }}</button>
        </section>
        <article v-for="(message, index) in renderedMessages" :key="message.id" class="agent-message" :class="message.role">
          <template v-if="message.role === 'user'"><p class="agent-user-text">{{ message.content }}</p><small class="agent-message-context"><FileText :size="11" />{{ message.attachment }}</small></template>
          <template v-else>
            <div class="agent-author"><Sparkles :size="13" />{{ t('agent.title') }}</div>
            <details v-if="message.tools.length" class="agent-tool-list"><summary><Check :size="12" />{{ t('agent.steps', { count: message.tools.length }) }}</summary><div v-for="(tool, step) in message.tools" :key="step">{{ t(`agent.tools.${tool}`) }}</div></details>
            <!-- Sanitized allowlist; no links, images or remote content in replies. -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="agent-markdown" v-html="message.html" />
            <section v-if="message.edit" class="agent-edit">
              <strong>{{ message.edit.title }}</strong>
              <details open><summary>{{ t('agent.viewChanges') }}</summary><div class="agent-diff-label">{{ t('agent.before') }}</div><pre class="agent-diff-before">{{ message.edit.oldText || t('agent.append') }}</pre><div class="agent-diff-label">{{ t('agent.after') }}</div><pre class="agent-diff-after">{{ message.edit.newText || t('agent.deleteText') }}</pre></details>
              <footer><span>{{ t(`agent.editStatus.${message.edit.status}`) }}</span><template v-if="message.edit.status === 'pending'"><button type="button" :disabled="agent.busy" @click="message.edit.status = 'dismissed'">{{ t('agent.dismiss') }}</button><button type="button" class="agent-primary" :disabled="agent.busy" @click="agent.apply(message.edit)">{{ t('agent.apply') }}</button></template><button v-if="message.edit.status === 'applied'" type="button" :disabled="agent.busy" @click="agent.revert(message.edit)"><RotateCcw :size="12" />{{ t('agent.revert') }}</button></footer>
            </section>
            <p v-if="message.error" class="agent-error" role="alert">{{ message.error }}</p>
            <p v-if="message.cancelled" class="agent-muted">{{ t('agent.stopped') }}</p>
            <div v-if="message.content || message.error || message.cancelled" class="agent-message-actions"><button v-if="message.content" type="button" :aria-label="t('agent.copy')" :title="t('agent.copy')" @click="copy(message.id, message.content)"><component :is="copied === message.id ? Check : Copy" :size="13" /></button><button v-if="(message.error || message.cancelled) && index === renderedMessages.length - 1" type="button" :disabled="agent.busy" @click="agent.retry"><RotateCcw :size="12" />{{ t('agent.retry') }}</button></div>
          </template>
        </article>
        <div v-if="agent.runningHere" class="agent-working" role="status"><LoaderCircle :size="14" class="agent-spin" />{{ t(agent.stopping ? 'agent.stopping' : 'agent.working') }}</div>
      </div>
      <button v-if="!nearBottom" type="button" class="agent-jump" @click="scrollBottom(true)"><ArrowDown :size="13" />{{ t('agent.latest') }}</button>
      <div v-if="agent.error" class="agent-composer-error" role="alert">{{ agent.error }}<button type="button" :aria-label="t('common.close')" @click="agent.error = ''"><X :size="13" /></button></div>
      <div class="agent-composer">
        <div class="agent-context-row"><label :title="attachmentName"><input v-model="agent.includeDocument" type="checkbox" :disabled="!editor.currentFile"><FileText :size="12" /><span>{{ attachmentName }}</span></label><button v-if="selected" type="button" :aria-label="t('agent.clearSelection')" :title="t('agent.clearSelection')" @click="agent.selection = null"><X :size="12" /></button><button v-else type="button" :disabled="!editor.currentFile" :aria-label="t('agent.attachSelection')" :title="t('agent.attachSelection')" @mousedown.prevent @click="agent.attachSelection"><TextSelect :size="14" /></button></div>
        <textarea ref="input" v-model="agent.conversation.draft" :aria-label="t('agent.inputLabel')" :placeholder="t('agent.placeholder')" rows="3" @keydown="onKey" />
        <div class="agent-send-row"><small>{{ t('agent.keyboardHint') }}</small><button v-if="agent.busy" type="button" class="agent-stop" :disabled="agent.stopping" :aria-label="t('agent.stop')" :title="t('agent.stop')" @click="agent.stop"><Square :size="14" /></button><button v-else type="button" class="agent-primary" :disabled="!agent.conversation.draft.trim() || agent.loadingConfig || !agent.config" :aria-label="t('agent.send')" :title="t('agent.send')" @click="send"><ArrowUp :size="17" /></button></div>
      </div>
      <p class="agent-privacy-note">{{ t('agent.privacyNote') }}</p>
    </template>
  </aside>
</template>
