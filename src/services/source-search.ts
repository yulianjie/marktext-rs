import type { SearchOpt } from '@/bus'

export interface SourceSearchMatch {
  from: number
  to: number
}

const WORD_CHARACTER = /[\p{L}\p{N}_]/u

function isWholeWord(text: string, from: number, to: number): boolean {
  const before = from > 0 ? text[from - 1] : ''
  const after = to < text.length ? text[to] : ''
  return (!before || !WORD_CHARACTER.test(before)) && (!after || !WORD_CHARACTER.test(after))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Resolve source-mode matches without touching Muya. The returned offsets are
 * CodeMirror document positions and can be passed directly to a transaction.
 * Invalid regular expressions deliberately produce no matches instead of
 * breaking the shared find bar.
 */
export function findSourceMatches(
  text: string,
  query: string,
  options: SearchOpt = {},
): SourceSearchMatch[] {
  if (!query) return []

  let expression: RegExp
  try {
    expression = new RegExp(
      options.regex ? query : escapeRegExp(query),
      options.caseSensitive ? 'gu' : 'giu',
    )
  } catch {
    return []
  }

  const matches: SourceSearchMatch[] = []
  let match: RegExpExecArray | null
  while ((match = expression.exec(text)) !== null) {
    const from = match.index
    const to = from + match[0].length
    if ((!options.wholeWord || isWholeWord(text, from, to)) && to > from) {
      matches.push({ from, to })
    }
    // A zero-width regular expression must still advance or RegExp.exec loops
    // forever. Empty ranges are not useful selections, so they are skipped.
    if (match[0].length === 0) expression.lastIndex += 1
  }
  return matches
}

export function firstSourceMatchAtOrAfter(
  matches: SourceSearchMatch[],
  position: number,
): number {
  if (!matches.length) return -1
  const index = matches.findIndex(match => match.from >= position)
  return index === -1 ? 0 : index
}

export function stepSourceMatch(
  matches: SourceSearchMatch[],
  currentIndex: number,
  direction: 'next' | 'previous',
): number {
  if (!matches.length) return -1
  if (currentIndex < 0 || currentIndex >= matches.length) {
    return direction === 'next' ? 0 : matches.length - 1
  }
  const delta = direction === 'next' ? 1 : -1
  return (currentIndex + delta + matches.length) % matches.length
}
