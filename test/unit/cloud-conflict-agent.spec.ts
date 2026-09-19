import { describe, expect, it } from 'vitest'
import { reviewProposal } from '../../src/services/agent'
import { buildGitConflictAgentRequest, gitConflictReviewPrompt, scanGitConflictHunks } from '../../src/services/cloud-conflict-agent'

const requestId = '00000000-0000-4000-8000-000000000001'
const markdown = [
  '# Note',
  '<<<<<<< HEAD',
  'local paragraph',
  '=======',
  'remote paragraph',
  '>>>>>>> origin/main',
  'tail',
].join('\n')

describe('Git conflict Agent preparation', () => {
  it('finds each exact hunk and preserves its UTF-16 selection boundaries', () => {
    const source = `${markdown}\n<<<<<<< HEAD\nlocal two\n=======\nremote two\n>>>>>>> origin/main\n`
    const hunks = scanGitConflictHunks(source)
    expect(hunks).toHaveLength(2)
    expect(source.slice(hunks[0]!.from, hunks[0]!.to)).toBe(hunks[0]!.conflictText)
    expect(hunks[0]).toMatchObject({ startLine: 2, endLine: 6, local: 'local paragraph\n', remote: 'remote paragraph\n' })
    expect(hunks[1]).toMatchObject({ startLine: 8, endLine: 12 })
  })

  it('creates a proposal-compatible request narrowed to one hunk, never a workspace reference', () => {
    const hunk = scanGitConflictHunks(markdown)[0]!
    const request = buildGitConflictAgentRequest({ requestId, language: 'zh-CN', fileName: 'notes/plan.md', markdown, hunk, base: 'base paragraph\n' })
    expect(request).toMatchObject({
      requestId,
      language: 'zh-CN',
      context: { name: 'notes/plan.md', markdown },
      editRange: { from: hunk.from, to: hunk.to },
      readOnly: false,
    })
    expect(request.references).toBeUndefined()
    expect(request.messages).toHaveLength(1)
    expect(request.messages[0]!.content).toContain('REVIEW-ONLY')
    expect(request.messages[0]!.content).toContain('Do not run Git, commit, push, pull, reset')

    // This is the existing reviewed-edit gate: the request can only suggest a
    // replacement inside the conflict block; it cannot apply anything itself.
    const reviewed = reviewProposal({ tabId: 'tab', name: 'plan.md', markdown, from: hunk.from, to: hunk.to }, {
      title: 'Resolve selected conflict', oldText: hunk.conflictText, newText: 'resolved paragraph\n',
    })
    expect(reviewed.changes[0]).toMatchObject({ from: hunk.from, to: hunk.to, status: 'pending' })
  })

  it('bounds previews and rejects tampered hunk coordinates or incomplete conflict markers', () => {
    const hunk = scanGitConflictHunks(markdown)[0]!
    const prompt = gitConflictReviewPrompt({ requestId, language: 'en', fileName: 'plan.md', markdown, hunk, base: 'b'.repeat(20_000) })
    expect(prompt.length).toBeLessThanOrEqual(36_000)
    expect(prompt).toContain('Preview truncated')
    expect(() => buildGitConflictAgentRequest({ requestId, language: 'en', fileName: 'plan.md', markdown, hunk: { ...hunk, to: hunk.to - 1 } })).toThrow('cloud:invalidConflict')
    expect(() => scanGitConflictHunks('<<<<<<< HEAD\nlocal\n=======\nremote\n')).toThrow('cloud:invalidConflict')
  })
})
