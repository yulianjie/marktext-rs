export interface MarkdownWordCount {
  paragraph: number
  word: number
  character: number
  all: number
}

/**
 * Mirror Muya's upstream `wordCount` semantics for source-mode edits.
 *
 * Counts intentionally include Markdown markers because Muya computes from
 * its exported Markdown rather than rendered text. CJK ideographs count as
 * individual words; other non-whitespace runs count as one word. The empty
 * document is one logical paragraph, matching Muya's synthetic empty line.
 */
export function computeMarkdownWordCount(markdown: string): MarkdownWordCount {
  const text = markdown.replace(/\r\n?/g, '\n')
  const paragraph = Math.max(1, text.split(/\n{2,}/).filter(Boolean).length)
  const withoutCjk = text.replace(/[\u4e00-\u9fa5]/g, '')
  const tokens = withoutCjk.split(/[\s\n]+/).filter(Boolean)
  const cjkLength = text.length - withoutCjk.length

  return {
    paragraph,
    word: cjkLength + tokens.length,
    character: cjkLength + tokens.reduce((total, token) => total + token.length, 0),
    all: text.length,
  }
}
