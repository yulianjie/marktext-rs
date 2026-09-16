import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { reviewSource, type AgentEvent } from '../../src/services/agent'
import { createSearchRevealRequest, revealRequestToEditorRange } from '../../src/services/search-reveal'

const transport = vi.hoisted(() => ({ start: vi.fn(), cancel: vi.fn(), listen: vi.fn() }))
vi.mock('@/services/agent-transport', () => ({ agentTransport: transport }))
vi.mock('@/services/tauri-invoke', () => ({ readMarkdown: vi.fn(), saveMarkdown: vi.fn(), saveAsDialog: vi.fn(), renameFile: vi.fn() }))
vi.mock('element-plus', () => ({ ElMessageBox: { confirm: vi.fn() }, ElNotification: vi.fn() }))
import { useAgentStore } from '../../src/stores/agent'
import { useEditorStore } from '../../src/stores/editor'
import { usePreferencesStore } from '../../src/stores/preferences'

let emit: (event: AgentEvent) => void
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  transport.listen.mockImplementation(async handler => { emit = handler; return () => {} })
  transport.start.mockResolvedValue(undefined)
  usePreferencesStore().autoSave = false
})

describe('Answer reuse and exact sources', () => {
  it('maps attachment-local multiline citations to exact document UTF16 positions and rejects fabricated quotes', () => {
    const markdown = '# title\n前文 😀aaa\n中😀文\n尾部'
    const from = markdown.indexOf('😀aaa'), to = markdown.indexOf('\n尾部')
    const snapshot = { tabId: 'doc', name: 'note', markdown, from, to }
    const source = reviewSource(snapshot, { label: '原文', startLine: 1, endLine: 2, quote: '😀aaa\n中😀文' })
    expect(source.snapshot).toEqual(snapshot)
    expect(source.startLine).toBe(2)
    const request = createSearchRevealRequest({ tabId: 'doc', path: '', mode: 'source', line: 1, column: 1, length: 0, exactRange: { markdown, from, to } })
    expect(revealRequestToEditorRange(markdown, request)).toEqual({ from, to, line: 1, startCh: 3, endLine: 2, endCh: 4 })
    expect(revealRequestToEditorRange(markdown + 'changed', request)).toBeNull()
    for (const invalid of [{ startLine: 0, endLine: 2, quote: '😀aaa\n中😀文' }, { startLine: 1, endLine: 3, quote: '😀aaa\n中😀文' }, { startLine: 1, endLine: 2, quote: 'fabricated' }]) {
      expect(() => reviewSource(snapshot, { label: 'bad', ...invalid })).toThrow('agent:invalidSource')
    }
  })

  it('requires successful completion and creates an unsaved independent note without model calls', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const original = editor.newUntitledTab('original')
    await agent.send('summary')
    const id = agent.run!.id, message = agent.conversation.messages.at(-1)!
    emit({ requestId: id, kind: 'delta', text: '# Summary\r\n\nresult' })
    agent.useAnswer(message.id, 'new')
    expect(editor.tabs).toHaveLength(1)
    emit({ requestId: id, kind: 'done' })
    expect(agent.canUseAnswer(message)).toBe(true)
    agent.useAnswer(message.id, 'new')
    expect(editor.tabs).toHaveLength(2)
    expect(editor.currentFile?.markdown).toBe('# Summary\n\nresult')
    expect(editor.currentFile?.isSaved).toBe(false)
    expect(editor.currentFile?.lastSavedMarkdown).toBe('')
    expect(original.markdown).toBe('original')
    expect(transport.start).toHaveBeenCalledOnce()
  })

  it('inserts and replaces captured ranges through editor transactions, refusing stale selections', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const tab = editor.newUntitledTab('hello 😀world')
    editor.sourceCodeMode = true
    tab.sourceSelection = { ranges: [{ anchor: 6, head: 13 }], main: 0 }
    const apply = vi.fn((markdown: string) => editor.setMarkdownExternal(tab.id, markdown))
    editor.registerAgentEditHandler('source', apply)
    await agent.send('answer')
    const id = agent.run!.id, message = agent.conversation.messages.at(-1)!
    emit({ requestId: id, kind: 'delta', text: 'new' })
    emit({ requestId: id, kind: 'done' })
    agent.useAnswer(message.id, 'insert')
    expect(tab.markdown).toBe('hello new😀world')
    agent.useAnswer(message.id, 'replace')
    expect(apply).toHaveBeenCalledOnce()
    expect(agent.error).not.toBe('')
    editor.setMarkdownExternal(tab.id, 'hello 😀world')
    agent.useAnswer(message.id, 'replace')
    expect(tab.markdown).toBe('hello new')
    agent.useAnswer(message.id, 'append')
    expect(tab.markdown).toBe('hello new\n\nnew')
    expect(transport.start).toHaveBeenCalledOnce()
  })

  it('disables error and cancelled partial answers and rejects invalid or stale source events', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const tab = editor.newUntitledTab('valid')
    await agent.send('summary')
    const id = agent.run!.id, message = agent.conversation.messages.at(-1)!
    emit({ requestId: id, kind: 'source', text: JSON.stringify({ label: 'source', startLine: 1, endLine: 1, quote: 'fabricated' }) })
    expect(message.sources).toBeUndefined()
    emit({ requestId: id, kind: 'source', text: JSON.stringify({ label: 'source', startLine: 1, endLine: 1, quote: 'valid' }) })
    expect(message.sources).toHaveLength(1)
    emit({ requestId: id, kind: 'delta', text: 'partial' })
    emit({ requestId: id, kind: 'cancelled' })
    expect(agent.canUseAnswer(message)).toBe(false)
    agent.useAnswer(message.id, 'new')
    expect(editor.tabs).toHaveLength(1)
    tab.markdown = 'modified'
    agent.locateSource(message.sources![0]!.snapshot)
    expect(agent.error).not.toBe('')
    emit({ requestId: id, kind: 'done' })
    expect(agent.canUseAnswer(message)).toBe(false)
  })
})
