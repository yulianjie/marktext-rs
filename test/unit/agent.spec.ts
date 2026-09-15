import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { markdownSelection, proposalMarkdown, type AgentEvent, type AgentImage } from '../../src/services/agent'
import { readAgentImage } from '../../src/services/agent-images'

const transport = vi.hoisted(() => ({ getConfig: vi.fn(), saveConfig: vi.fn(), testConnection: vi.fn(), start: vi.fn(), cancel: vi.fn(), listen: vi.fn(), listSkills: vi.fn(), importSkill: vi.fn() }))
vi.mock('@/services/agent-transport', () => ({ agentTransport: transport }))
vi.mock('@/services/agent-images', async importOriginal => ({ ...await importOriginal<typeof import('../../src/services/agent-images')>(), readAgentImage: vi.fn() }))
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
  transport.listSkills.mockResolvedValue([])
  usePreferencesStore().autoSave = false
})

const snapshot = { tabId: 'doc', name: 'note.md', markdown: 'same\nhello world\nsame', from: 5, to: 16 }
describe('Agent document edits', () => {
  const picture: AgentImage = { name: 'image.png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=' }
  it('automatically captures reversed source selections, respects removal and isolates attachment settings', () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const first = editor.newUntitledTab('private\nselected text\nprivate')
    editor.sourceCodeMode = true
    first.sourceSelection = { ranges: [{ anchor: 21, head: 8 }], main: 0 }
    agent.toggle()
    expect(agent.selection?.markdown.slice(agent.selection.from, agent.selection.to)).toBe('selected text')
    agent.clearSelection()
    agent.attachSelection(true)
    expect(agent.selection).toBeNull()
    agent.attachSelection()
    expect(agent.selection).not.toBeNull()
    agent.includeDocument = false
    agent.clearSelection()
    agent.attachSelection(true)
    expect(agent.includeDocument).toBe(false)
    expect(agent.selection).toBeNull()
    editor.newUntitledTab('another')
    expect(agent.includeDocument).toBe(true)
    editor.setCurrent(first.id)
    expect(agent.includeDocument).toBe(false)
    agent.clear()
    expect(agent.includeDocument).toBe(false)
  })
  it('sends image-only messages, retains images in follow-ups and retries the same immutable context', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const tab = editor.newUntitledTab('hello world')
    agent.conversation.images = [{ ...picture }]
    await agent.send('')
    expect(transport.start.mock.calls[0]![0].messages).toEqual([{ role: 'user', content: '', images: [picture] }])
    expect(agent.conversation.images).toEqual([])
    emit({ requestId: agent.run!.id, kind: 'error', text: 'agent:network' })
    agent.includeDocument = false
    agent.retry()
    await vi.waitFor(() => expect(transport.start).toHaveBeenCalledTimes(2))
    expect(transport.start.mock.calls[1]![0].context?.markdown).toBe(tab.markdown)
    expect(transport.start.mock.calls[1]![0].messages[0].images).toEqual([picture])
    emit({ requestId: agent.run!.id, kind: 'done' })
    await agent.send('What is in the image?')
    expect(transport.start.mock.calls[2]![0].messages[0].images).toEqual([picture])
    expect(transport.start.mock.calls[2]![0].messages.at(-1).images).toBeUndefined()
  })
  it('keeps pending image reads with their document and discards reads after clearing a conversation', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const tab = editor.newUntitledTab('first')
    let finish!: (image: AgentImage) => void
    vi.mocked(readAgentImage).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const adding = agent.addImages([{} as File])
    await agent.addImages([{} as File])
    expect(agent.error).not.toBe('')
    await agent.send('not ready')
    expect(transport.start).not.toHaveBeenCalled()
    editor.newUntitledTab('second')
    finish(picture)
    await adding
    expect(agent.conversation.images).toEqual([])
    editor.setCurrent(tab.id)
    expect(agent.conversation.images).toEqual([picture])
    const discarded = agent.addImages([{} as File])
    agent.clear()
    finish(picture)
    await discarded
    expect(agent.conversation.images).toEqual([])
    expect(agent.conversation.readingImages).toBe(false)
  })
  it('rejects a failed batch without losing existing images and guards count limits', async () => {
    const agent = useAgentStore()
    agent.conversation.images = [{ ...picture }]
    vi.mocked(readAgentImage).mockResolvedValueOnce(picture).mockRejectedValueOnce(new Error('agent:imageRead'))
    await agent.addImages([{} as File, {} as File])
    expect(agent.conversation.images).toEqual([picture])
    expect(agent.error).not.toBe('')
    await agent.addImages(Array.from({ length: 4 }, () => ({} as File)))
    expect(agent.conversation.images).toEqual([picture])
    expect(agent.conversation.readingImages).toBe(false)
  })
  it('refuses stale selection sends and stale retries without sending a different document', async () => {
    const editor = useEditorStore(), agent = useAgentStore()
    const tab = editor.newUntitledTab('hello world')
    editor.sourceCodeMode = true
    tab.sourceSelection = { ranges: [{ anchor: 0, head: 5 }], main: 0 }
    agent.attachSelection(true)
    await agent.send('revise')
    emit({ requestId: agent.run!.id, kind: 'error', text: 'agent:network' })
    editor.setMarkdownExternal(tab.id, 'changed document')
    agent.retry()
    expect(transport.start).toHaveBeenCalledTimes(1)
    expect(agent.conversation.draft).toBe('revise')
    await agent.send()
    expect(transport.start).toHaveBeenCalledTimes(1)
  })
  it('keeps document size separate from chat context and defaults to automatic skills', async () => {
    useEditorStore().newUntitledTab('x'.repeat(400_000))
    const agent = useAgentStore()
    await agent.send('Explain Markdown tables')
    expect(transport.start).toHaveBeenCalledOnce()
    expect(transport.start.mock.calls[0]![0].skillIds).toEqual([])
  })
  it('sends chosen skills and clears selections when disabled or removed', async () => {
    useEditorStore().newUntitledTab('hello')
    const agent = useAgentStore()
    const skill = { id: 'user:sample', name: 'sample', description: 'Explain', enabled: true, builtin: false, source: null, license: 'MIT' }
    transport.listSkills.mockResolvedValue([skill])
    await agent.loadSkills()
    agent.conversation.skillId = skill.id
    agent.includeDocument = false
    await agent.send('Explain this concept')
    expect(transport.start.mock.calls[0]![0].skillIds).toEqual(['user:sample'])
    const id = agent.run!.id
    emit({ requestId: id, kind: 'tool', text: 'read_skill' })
    emit({ requestId: id, kind: 'tool', text: 'read_skill_file' })
    emit({ requestId: id, kind: 'done' })
    expect(agent.conversation.messages.at(-1)!.tools).toEqual(['read_skill', 'read_skill_file'])
    await agent.changeSkills(async () => [{ ...skill, enabled: false }])
    expect(agent.conversation.skillId).toBe('')
    await agent.changeSkills(async () => null)
    expect(agent.skills).toHaveLength(1)
    await agent.changeSkills(async () => { throw new Error('agent:skillInvalid') })
    expect(agent.skillsError).not.toBe('')
    expect(agent.skills).toHaveLength(1)
    await agent.changeSkills(async () => [])
    expect(agent.skills).toHaveLength(0)
  })
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
