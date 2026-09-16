import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createChapterSummary, finishSummaryJob, summaryChunks, summaryJobInput, utf8Size, SUMMARY_CHUNK_BYTES } from '../../src/services/agent-summary'
import type { AgentEvent, AgentRequest } from '../../src/services/agent'
const transport = vi.hoisted(() => ({ start: vi.fn(), cancel: vi.fn(), listen: vi.fn() }))
vi.mock('@/services/agent-transport', () => ({ agentTransport: transport }))
vi.mock('@/services/tauri-invoke', () => ({ readMarkdown: vi.fn(), saveMarkdown: vi.fn(), saveAsDialog: vi.fn(), renameFile: vi.fn() }))
vi.mock('element-plus', () => ({ ElMessageBox: { confirm: vi.fn() }, ElNotification: vi.fn() }))
import { useAgentStore } from '../../src/stores/agent'
import { useEditorStore } from '../../src/stores/editor'
import { usePreferencesStore } from '../../src/stores/preferences'
let emit: (event: AgentEvent) => void
beforeEach(() => {
  setActivePinia(createPinia()); vi.clearAllMocks()
  transport.listen.mockImplementation(async handler => { emit = handler; return () => {} })
  transport.start.mockResolvedValue(undefined)
  transport.cancel.mockImplementation(async id => emit({ requestId: id, kind: 'cancelled' }))
  usePreferencesStore().autoSave = false
})
const complete = (request: AgentRequest, content = 'Concise notes') => {
  emit({ requestId: request.requestId, kind: 'delta', text: content })
  emit({ requestId: request.requestId, kind: 'done' })
}

describe('Bounded chapter summary', () => {
  it('covers UTF8, huge lines, fences and many tiny headings without gaps or surrogate splits', () => {
    for (const text of ['# 标题\n' + '😀汉字'.repeat(16000), '# hi\n' + '```md\n' + '# fake\n'.repeat(7000) + '```\n# real\nend', '# h\nx\n'.repeat(30000)]) {
      const chunks = summaryChunks(text)
      expect(chunks.map(c => text.slice(c.from, c.to)).join('')).toBe(text)
      expect(chunks.length).toBeLessThanOrEqual(Math.ceil(utf8Size(text) / 10000))
      for (const [index, chunk] of chunks.entries()) {
        expect(chunk.from).toBe(index ? chunks[index - 1]!.to : 0)
        const content = text.slice(chunk.from, chunk.to)
        expect(utf8Size(content)).toBeLessThanOrEqual(SUMMARY_CHUNK_BYTES)
        expect(new TextDecoder().decode(new TextEncoder().encode(content))).toBe(content)
      }
    }
  })
  it('bounds every synthesis input and refuses oversized notes without claiming completion', () => {
    const markdown = '😀text\n'.repeat(60000)
    const summary = createChapterSummary({ markdown, from: 0, to: markdown.length, name: 'doc', tabId: '1' })
    for (let index = 0; index < summary.jobs.length; index++) {
      expect(utf8Size(summaryJobInput(summary, index).prompt)).toBeLessThan(26000)
      expect(() => finishSummaryJob(summary, index, 'x'.repeat(80001))).toThrow('agent:summaryOutputTooLarge')
      expect(summary.jobs[index]!.result).toBeUndefined()
      finishSummaryJob(summary, index, '中'.repeat(2000))
    }
  })
  it('retains completed chunks across cancellation, resumes only incomplete work, and reuses final answer', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const tab = editor.newUntitledTab('# Long\n' + 'word\n'.repeat(10000))
    let count = 0
    transport.start.mockImplementation(async request => { if (++count !== 2) complete(request) })
    const task = agent.summarizeChapters()
    await vi.waitFor(() => expect(transport.start).toHaveBeenCalledTimes(2))
    await agent.stop(); await task
    const message = agent.conversation.messages.at(-1)!, summary = message.summary!
    expect(summary.status).toBe('cancelled'); expect(message.completed).toBe(false)
    expect(summary.jobs[0]!.result).toBe('Concise notes')
    expect(summary.jobs[1]!.result).toBeUndefined()
    const firstPrompt = transport.start.mock.calls[0]![0].messages[0].content
    transport.start.mockImplementation(async request => complete(request, 'Final or notes'))
    await agent.summarizeChapters(message.id)
    expect(transport.start.mock.calls.filter(([r]) => r.messages[0].content === firstPrompt)).toHaveLength(1)
    expect(summary.status).toBe('done'); expect(message.completed).toBe(true)
    expect(transport.start.mock.calls.every(([r]) => r.readOnly === true)).toBe(true)
    expect(tab.markdown).toContain('# Long')
    agent.useAnswer(message.id, 'new')
    expect(editor.currentFile!.markdown).toBe('Final or notes')
  })
  it('keeps completed coverage after oversized notes and retries only that part', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    editor.newUntitledTab('word\n'.repeat(10000))
    let count = 0
    transport.start.mockImplementation(async request => complete(request, ++count === 2 ? 'x'.repeat(6001) : 'valid notes'))
    await agent.summarizeChapters()
    const message = agent.conversation.messages.at(-1)!, summary = message.summary!
    expect(summary.status).toBe('error')
    expect(summary.jobs[0]!.result).toBe('valid notes')
    expect(summary.jobs[1]!.result).toBeUndefined()
    expect(agent.canUseAnswer(message)).toBe(false)
    transport.start.mockImplementation(async request => complete(request, 'recovered notes'))
    await agent.summarizeChapters(message.id)
    expect(summary.jobs[0]!.result).toBe('valid notes')
    expect(summary.status).toBe('done')
  })
  it('keeps the immutable running summary with its original document when switching tabs', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const original = editor.newUntitledTab('first document')
    const task = agent.summarizeChapters()
    await vi.waitFor(() => expect(transport.start).toHaveBeenCalledOnce())
    const message = agent.conversation.messages.at(-1)!
    editor.newUntitledTab('second document')
    expect(agent.runningHere).toBe(false)
    expect(agent.runningKey).toBe(original.id)
    expect(agent.conversation.messages).toHaveLength(0)
    transport.start.mockImplementation(async request => complete(request))
    complete(transport.start.mock.calls[0]![0])
    await task
    expect(message.completed).toBe(true)
    expect(message.targetTabId).toBe(original.id)
    expect(agent.conversation.messages).toHaveLength(0)
  })
  it('rejects stale or attachment-off resumes and preserves completed jobs', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const tab = editor.newUntitledTab('short')
    const task = agent.summarizeChapters()
    await vi.waitFor(() => expect(transport.start).toHaveBeenCalledOnce())
    await agent.stop(); await task
    const message = agent.conversation.messages.at(-1)!
    tab.markdown = 'changed'
    await agent.summarizeChapters(message.id)
    expect(transport.start).toHaveBeenCalledOnce()
    agent.includeDocument = false
    await agent.summarizeChapters(message.id)
    expect(transport.start).toHaveBeenCalledOnce()
    expect(message.error).toBeTruthy()
  })
})

describe('Independent read and edit scopes', () => {
  it('defaults to selection-only, explicitly expands read/citation scope, rejects edits outside selection, and honors attachment-off', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const tab = editor.newUntitledTab('prefix\n😀 selected\nprivate tail')
    agent.selection = { tabId: tab.id, name: tab.filename, markdown: tab.markdown, from: 7, to: 18 }
    await agent.send('rewrite')
    expect(transport.start.mock.calls[0]![0].context.markdown).toBe('😀 selected')
    complete(transport.start.mock.calls[0]![0])
    agent.referenceDocument = true
    await agent.send('rewrite with whole context')
    const request = transport.start.mock.calls[1]![0]
    expect(request.context.markdown).toBe(tab.markdown)
    expect(request.editRange).toEqual({ from: 7, to: 18 })
    emit({ requestId: request.requestId, kind: 'source', text: JSON.stringify({ label: 'context', startLine: 3, endLine: 3, quote: 'private tail' }) })
    expect(agent.conversation.messages.at(-1)!.sources![0]!.snapshot.from).toBe(19)
    emit({ requestId: request.requestId, kind: 'proposal', proposal: { title: 'escape', changes: [{ oldText: 'prefix', newText: 'bad' }] } })
    expect(agent.conversation.messages.at(-1)!.edit).toBeUndefined()
    complete(request)
    agent.includeDocument = false
    await agent.send('standalone')
    expect(transport.start.mock.calls[2]![0].context).toBeNull()
    expect(transport.start.mock.calls[2]![0].editRange).toBeUndefined()
  })
})
