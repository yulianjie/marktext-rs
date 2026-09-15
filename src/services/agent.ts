/** Shared IPC contract and deterministic edit validation. */
export interface AgentSettings { baseUrl: string; model: string }
export interface AgentConfig extends AgentSettings { hasKey: boolean }
export interface AgentImage { name: string; dataUrl: string }
export interface AgentMessage { role: 'user' | 'assistant'; content: string; images?: AgentImage[] }
export interface AgentContext { name: string; markdown: string }
export interface AgentSkill {
  id: string
  name: string
  description: string
  license: string | null
  source: string | null
  builtin: boolean
  enabled: boolean
}
export interface AgentSkillDetail { id: string; instructions: string; files: string[] }
export interface AgentRequest {
  requestId: string
  messages: AgentMessage[]
  context: AgentContext | null
  language: string
  skillIds?: string[]
}
export interface AgentProposal { title: string; oldText: string; newText: string }
export interface AgentEvent {
  requestId: string
  kind: 'delta' | 'tool' | 'proposal' | 'done' | 'cancelled' | 'error'
  text?: string
  proposal?: AgentProposal
}
export interface DocumentSnapshot { tabId: string; name: string; markdown: string; from: number; to: number }
export interface ReviewedEdit extends AgentProposal {
  snapshot: DocumentSnapshot
  status: 'pending' | 'applied' | 'dismissed' | 'reverted'
  appliedMarkdown?: string
}

export function proposalMarkdown(snapshot: DocumentSnapshot, proposal: AgentProposal): string {
  const { markdown, from, to } = snapshot
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > markdown.length) throw new Error('agent:invalidEdit')
  const scope = markdown.slice(from, to)
  const oldText = proposal.oldText
  const index = oldText ? scope.indexOf(oldText) : scope.length
  if (index < 0 || oldText && scope.indexOf(oldText, index + 1) !== -1 || oldText === proposal.newText) throw new Error('agent:invalidEdit')
  return markdown.slice(0, from + index) + proposal.newText.replace(/\r\n?/g, '\n') + markdown.slice(from + index + oldText.length)
}

/** Convert Muya's exported Markdown coordinates, not rendered DOM text. */
export function markdownSelection(markdown: string, cursor: unknown): { from: number; to: number } | null {
  const position = (value: unknown): number | null => {
    if (!value || typeof value !== 'object') return null
    const { line, ch } = value as { line?: number; ch?: number }
    const lines = markdown.split('\n')
    if (!Number.isInteger(line) || !Number.isInteger(ch) || line! < 0 || line! >= lines.length || ch! < 0 || ch! > lines[line!]!.length) return null
    return lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0) + ch!
  }
  if (!cursor || typeof cursor !== 'object') return null
  const { anchor, focus } = cursor as { anchor: unknown; focus: unknown }
  const a = position(anchor), b = position(focus)
  return a === null || b === null || a === b ? null : { from: Math.min(a, b), to: Math.max(a, b) }
}

export const AGENT_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: '' },
  { id: 'custom', name: 'custom', baseUrl: '', model: '' },
] as const
