import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { useEditorStore } from './editor'
import { agentTransport } from '@/services/agent-transport'
import { getLocale, t } from '@/i18n'
import {
  markdownSelection, proposalMarkdown,
  type AgentConfig, type AgentEvent, type AgentSettings, type AgentSkill, type DocumentSnapshot, type ReviewedEdit,
} from '@/services/agent'

export interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachment?: string
  tools: string[]
  edit?: ReviewedEdit
  error?: string
  cancelled?: boolean
}
interface Conversation { messages: ChatItem[]; draft: string; skillId: string }

export function agentError(error: unknown): string {
  const code = String(error).match(/agent:([a-zA-Z]+)/)?.[1] ?? 'unknown'
  const message = t(`agent.errors.${code}`)
  return message.startsWith('agent.errors.') ? t('agent.errors.unknown') : message
}

export const useAgentStore = defineStore('agent', () => {
  const editor = useEditorStore()
  const visible = ref(false)
  const settingsOpen = ref(false)
  const skillsOpen = ref(false)
  const skills = ref<AgentSkill[]>([])
  const skillsLoading = ref(false)
  const skillsError = ref('')
  const config = ref<AgentConfig | null>(null)
  const loadingConfig = ref(false)
  const configError = ref('')
  const error = ref('')
  const includeDocument = ref(true)
  const selection = ref<DocumentSnapshot | null>(null)
  const sessions = ref<Record<string, Conversation>>({})
  const currentKey = computed(() => editor.currentFileId ?? 'no-document')
  function getConversation(key = currentKey.value): Conversation {
    return sessions.value[key] ?? (sessions.value[key] = { messages: [], draft: '', skillId: '' })
  }
  const conversation = computed(() => getConversation())
  const run = ref<{ id: string; key: string; messageId: string; snapshot: DocumentSnapshot | null } | null>(null)
  const busy = computed(() => run.value !== null)
  const runningHere = computed(() => run.value?.key === currentKey.value)
  const stopping = ref(false)
  let startPromise: Promise<void> | null = null
  let unlisten: (() => void) | null = null
  let listening: Promise<void> | null = null
  let disposed = false

  function updateSkills(items: AgentSkill[]) {
    skills.value = items
    for (const chat of Object.values(sessions.value)) {
      if (!items.some(s => s.id === chat.skillId && s.enabled)) chat.skillId = ''
    }
  }
  async function loadSkills() {
    if (skillsLoading.value) return
    skillsLoading.value = true
    skillsError.value = ''
    try { updateSkills(await agentTransport.listSkills()) }
    catch (cause) { skillsError.value = agentError(cause) }
    finally { skillsLoading.value = false }
  }
  async function changeSkills(action: () => Promise<AgentSkill[] | null>) {
    if (skillsLoading.value || busy.value) return
    skillsLoading.value = true
    skillsError.value = ''
    try { const items = await action(); if (items) updateSkills(items) }
    catch (cause) { skillsError.value = agentError(cause) }
    finally { skillsLoading.value = false }
  }

  async function loadConfig() {
    if (loadingConfig.value) return
    loadingConfig.value = true
    configError.value = ''
    try { config.value = await agentTransport.getConfig() }
    catch (cause) { configError.value = agentError(cause) }
    finally { loadingConfig.value = false }
  }

  async function saveConfig(settings: AgentSettings, apiKey?: string) {
    config.value = await agentTransport.saveConfig(settings, apiKey)
    configError.value = ''
  }

  function toggle() {
    visible.value = !visible.value
    if (visible.value && !config.value) void loadConfig()
  }

  function attachSelection() {
    const tab = editor.currentFile
    if (!tab) return
    let range: { from: number; to: number } | null = null
    if (editor.sourceCodeMode) {
      const data = tab.sourceSelection as { ranges?: { anchor: number; head: number }[]; main?: number } | null
      const selected = data?.ranges?.[data.main ?? 0]
      if (selected && selected.anchor !== selected.head) range = { from: Math.min(selected.anchor, selected.head), to: Math.max(selected.anchor, selected.head) }
    } else {
      const muya = editor.getMuyaInstance() as { getCursor?: () => unknown } | null
      range = markdownSelection(tab.markdown, muya?.getCursor?.())
    }
    if (!range || range.from < 0 || range.to > tab.markdown.length) {
      error.value = t('agent.errors.noSelection')
      return
    }
    selection.value = { tabId: tab.id, name: tab.filename, markdown: tab.markdown, ...range }
    includeDocument.value = true
    error.value = ''
  }

  function snapshot(): DocumentSnapshot | null {
    const tab = editor.currentFile
    if (!includeDocument.value || !tab) return null
    if (selection.value?.tabId === tab.id) {
      if (selection.value.markdown !== tab.markdown) throw new Error('agent:selectionChanged')
      return { ...selection.value }
    }
    return { tabId: tab.id, name: tab.filename, markdown: tab.markdown, from: 0, to: tab.markdown.length }
  }

  function receive(event: AgentEvent) {
    const active = run.value
    if (!active || event.requestId !== active.id) return
    const message = sessions.value[active.key]?.messages.find(item => item.id === active.messageId)
    if (!message) return
    if (event.kind === 'delta') message.content += event.text ?? ''
    if (event.kind === 'tool' && ['read_document', 'search_document', 'propose_edit', 'read_skill', 'read_skill_file'].includes(event.text ?? '')) message.tools.push(event.text!)
    if (event.kind === 'proposal' && event.proposal && active.snapshot) {
      try {
        proposalMarkdown(active.snapshot, event.proposal)
        message.edit = { ...event.proposal, snapshot: active.snapshot, status: 'pending' }
      } catch { message.error = t('agent.errors.invalidEdit') }
    }
    if (['done', 'error', 'cancelled'].includes(event.kind)) {
      if (event.kind !== 'done') delete message.edit
      if (event.kind === 'error') message.error = agentError(event.text)
      if (event.kind === 'cancelled') message.cancelled = true
      run.value = null
      stopping.value = false
    }
  }

  async function ensureListener() {
    if (unlisten) return
    if (!listening) listening = agentTransport.listen(receive).then(off => {
      if (disposed) off()
      else unlisten = off
    }).finally(() => { listening = null })
    await listening
  }

  async function send(prompt = conversation.value.draft) {
    if (busy.value || skillsLoading.value || !prompt.trim()) return
    error.value = ''
    const chat = getConversation()
    const skillIds = chat.skillId ? [chat.skillId] : []
    let attached: DocumentSnapshot | null
    try {
      attached = snapshot()
      if (chat.messages.length >= 22) throw new Error('agent:historyFull')
      const total = new TextEncoder().encode(prompt + chat.messages.map(m => m.content).join('')).length
      const documentBytes = new TextEncoder().encode(attached?.markdown.slice(attached.from, attached.to) ?? '').length
      if (total > 220_000 || new TextEncoder().encode(prompt).length > 80_000 || documentBytes > 2_000_000) throw new Error('agent:contextTooLarge')
    } catch (cause) { error.value = agentError(cause); return }
    const requestId = crypto.randomUUID()
    const messageId = crypto.randomUUID()
    run.value = { id: requestId, key: currentKey.value, messageId, snapshot: attached }
    chat.messages.push({ id: crypto.randomUUID(), role: 'user', content: prompt.trim(), tools: [], attachment: attached ? `${attached.name} · ${selection.value?.tabId === attached.tabId ? t('agent.selection') : t('agent.document')}` : t('agent.noAttachment') })
    const messages = chat.messages.filter(m => !m.error && !m.cancelled).map(m => ({
      role: m.role,
      content: m.content + (m.edit ? `\n[Document edit status: ${m.edit.status}. Proposal: ${m.edit.title}]` : ''),
    }))
    chat.messages.push({ id: messageId, role: 'assistant', content: '', tools: [] })
    chat.draft = ''
    try {
      startPromise = (async () => {
        await ensureListener()
        if (disposed) { run.value = null; return }
        await agentTransport.start({ requestId, messages, language: getLocale(), skillIds, context: attached ? {
          name: attached.name, markdown: attached.markdown.slice(attached.from, attached.to),
        } : null })
      })()
      await startPromise
    } catch (cause) {
      receive({ requestId, kind: 'error', text: String(cause) })
    } finally { startPromise = null }
  }

  async function stop() {
    const active = run.value
    if (!active || stopping.value) return
    stopping.value = true
    try {
      // Listener registration and start acknowledgement must precede cancel.
      if (listening) await listening
      if (startPromise) await startPromise
      if (run.value?.id === active.id) await agentTransport.cancel(active.id)
    } catch (cause) { error.value = agentError(cause); stopping.value = false }
  }

  function clear() {
    if (busy.value) return
    sessions.value[currentKey.value] = { messages: [], draft: '', skillId: '' }
    error.value = ''
  }

  function apply(edit: ReviewedEdit) {
    if (busy.value || edit.status !== 'pending') return
    try {
      const next = proposalMarkdown(edit.snapshot, edit)
      edit.appliedMarkdown = editor.applyAgentEdit(edit.snapshot.tabId, edit.snapshot.markdown, next)
      edit.status = 'applied'
      selection.value = null
      error.value = ''
    } catch (cause) { error.value = agentError(cause) }
  }

  function revert(edit: ReviewedEdit) {
    if (busy.value || edit.status !== 'applied' || edit.appliedMarkdown === undefined) return
    try {
      editor.applyAgentEdit(edit.snapshot.tabId, edit.appliedMarkdown, edit.snapshot.markdown)
      edit.status = 'reverted'
      error.value = ''
    } catch (cause) { error.value = agentError(cause) }
  }

  function retry() {
    if (busy.value) return
    const chat = getConversation()
    const last = chat.messages.at(-1)
    const user = chat.messages.at(-2)
    if (last?.role !== 'assistant' || user?.role !== 'user' || !(last.error || last.cancelled)) return
    chat.messages.splice(-2)
    chat.draft = user.content
    void send()
  }

  onScopeDispose(() => {
    disposed = true
    void stop()
    unlisten?.()
  })

  return { visible, settingsOpen, skillsOpen, skills, skillsLoading, skillsError, loadSkills, changeSkills, config, loadingConfig, configError, error, includeDocument, selection, conversation,
    busy, runningHere, stopping, run, toggle, loadConfig, saveConfig, attachSelection, send, stop, clear, apply, revert, retry }
})
