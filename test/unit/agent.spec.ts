import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { markdownSelection, proposalMarkdown, type AgentEvent } from '../../src/services/agent'

const transport = vi.hoisted(() => ({ getConfig: vi.fn(), saveConfig: vi.fn(), testConnection: vi.fn(), start: vi.fn(), cancel: vi.fn(), listen: vi.fn() }))
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
  transport.cancel.mockResolvedValue(undefined)
  usePreferencesStore().autoSave = false
})

const snapshot = { tabId: 'doc', name: 'note.md', markdown: 'same\nhello world\nsame', from: 5, to: 16 }
describe('Agent document edits', () => {
  it('edits within the attached scope and preserves all surrounding content', () => {
    expect(proposalMarkdown(snapshot, { title: 'Edit', oldText: 'hello', newText: '你好' })).toBe('same\n你好 world\nsame')
    expect(proposalMarkdown(snapshot, { title: 'Append', oldText: '', newText: '!' })).toBe('same\nhello world!\nsame')
    expect(() => proposalMarkdown(snapshot, { title: 'Outside', oldText: 'same', newText: 'x' })).toThrow()
    expect(() => proposalMarkdown({ ...snapshot, from: 0, to: snapshot.markdown.length }, { title: 'Ambiguous', oldText: 'same', newText: 'x' })).toThrow()
  })
  it('maps reversed Markdown selections and rejects invalid coordinates', () => {
    expect(markdownSelection('你好\nworld', { anchor: { line: 1, ch: 3 }, focus: { line: 0, ch: 1 } })).toEqual({ from: 1, to: 6 })
    expect(markdownSelection('hi', { anchor: { line: 4, ch: 0 }, focus: { line: 0, ch: 0 } })).toBeNull()
  })
  it('requires explicit apply and refuses stale documents, then supports exact revert', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const tab = editor.newUntitledTab('hello world')
    editor.registerAgentEditHandler('wysiwyg', text => editor.setMarkdownExternal(tab.id, text))
    await agent.send('polish')
    const id = agent.run!.id
    emit({ requestId: id, kind: 'proposal', proposal: { title: 'Polish', oldText: 'hello', newText: 'Hello' } })
    const edit = agent.conversation.messages.at(-1)!.edit!
    expect(tab.markdown).toBe('hello world')
    agent.apply(edit)
    expect(tab.markdown).toBe('hello world') // no applying while streaming
    emit({ requestId: id, kind: 'done' })
    editor.setMarkdownExternal(tab.id, 'my edit')
    agent.apply(edit)
    expect(tab.markdown).toBe('my edit')
    expect(edit.status).toBe('pending')
    editor.setMarkdownExternal(tab.id, 'hello world')
    agent.apply(edit)
    expect(tab.markdown).toBe('Hello world')
    expect(edit.status).toBe('applied')
    agent.revert(edit)
    expect(tab.markdown).toBe('hello world')
    expect(edit.status).toBe('reverted')
  })
  it('isolates document conversations and does not attach a document when unchecked', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const first = editor.newUntitledTab('private first document')
    agent.includeDocument = false
    await agent.send('hello')
    const id = agent.run!.id
    expect(transport.start.mock.calls[0]![0].context).toBeNull()
    editor.newUntitledTab('second')
    expect(agent.conversation.messages).toHaveLength(0)
    emit({ requestId: id, kind: 'delta', text: 'first reply' })
    emit({ requestId: id, kind: 'done' })
    expect(agent.conversation.messages).toHaveLength(0)
    editor.setCurrent(first.id)
    expect(agent.conversation.messages.at(-1)?.content).toBe('first reply')
  })
  it('drops proposals on interrupted runs and ignores late events', async () => {
    useEditorStore().newUntitledTab('text')
    const agent = useAgentStore()
    await agent.send('edit')
    const id = agent.run!.id
    emit({ requestId: id, kind: 'proposal', proposal: { title: 'Edit', oldText: 'text', newText: 'next' } })
    emit({ requestId: id, kind: 'cancelled' })
    emit({ requestId: id, kind: 'delta', text: 'late' })
    expect(agent.busy).toBe(false)
    expect(agent.conversation.messages.at(-1)!.edit).toBeUndefined()
    expect(agent.conversation.messages.at(-1)!.content).toBe('')
  })
  it('waits for start acknowledgement before cancelling', async () => {
    useEditorStore().newUntitledTab('text')
    let resolveStart!: () => void
    transport.start.mockImplementation(() => new Promise<void>(resolve => { resolveStart = resolve }))
    const agent = useAgentStore()
    const send = agent.send('hello')
    await vi.waitFor(() => expect(transport.start).toHaveBeenCalledOnce())
    const stop = agent.stop()
    expect(transport.cancel).not.toHaveBeenCalled()
    resolveStart()
    await send; await stop
    expect(transport.cancel).toHaveBeenCalledWith(agent.run!.id)
  })
})
