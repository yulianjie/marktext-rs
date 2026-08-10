/**
 * A folder-search hit uses Rust/Unicode coordinates: line and column are
 * 1-based Unicode-scalar positions and length is a Unicode-scalar count.
 * Muya and CodeMirror consume 0-based JavaScript UTF-16 offsets instead.
 */
export interface SearchRevealCoordinates {
  line: number
  column: number
  length: number
}

export type SearchRevealMode = 'wysiwyg' | 'source'

export interface SearchRevealRequest extends SearchRevealCoordinates {
  requestId: number
  tabId: string
  path: string
  mode: SearchRevealMode
}

export type NewSearchRevealRequest = Omit<SearchRevealRequest, 'requestId'>

let searchRevealSequence = 0

/** Allocate a window-lifetime monotonic id for cross-component race guards. */
export function createSearchRevealRequest(
  request: NewSearchRevealRequest,
): SearchRevealRequest {
  searchRevealSequence += 1
  return { ...request, requestId: searchRevealSequence }
}

export interface EditorSearchRange {
  /** Zero-based source line for Muya's CodeMirror-style cursor. */
  line: number
  /** UTF-16 offsets within the line, suitable for Muya. */
  startCh: number
  endCh: number
  /** UTF-16 document offsets, suitable for CodeMirror 6. */
  from: number
  to: number
}

export interface SearchRevealGuardState {
  pending: SearchRevealRequest | null
  lastHandledRequestId: number
}

export interface SearchRevealBinding {
  currentTabId: string | null
  boundTabId: string | null
  consumerMode: SearchRevealMode
  activeMode: SearchRevealMode
}

export interface SearchRevealSettlement {
  state: SearchRevealGuardState
  request: SearchRevealRequest | null
}

export const emptySearchRevealGuard = (): SearchRevealGuardState => ({
  pending: null,
  lastHandledRequestId: 0,
})

/** Keep only the newest request. Already handled or out-of-order requests are ignored. */
export function enqueueSearchReveal(
  state: SearchRevealGuardState,
  request: SearchRevealRequest,
): SearchRevealGuardState {
  if (request.requestId <= state.lastHandledRequestId) return state
  if (state.pending && request.requestId <= state.pending.requestId) return state
  return { ...state, pending: request }
}

/**
 * Consume a request only after the requested tab is both current and bound to
 * the correct editor mode. A request aimed at a tab/mode that is no longer
 * current is discarded, so a delayed watcher can never reveal it in another
 * document.
 */
export function settleSearchReveal(
  state: SearchRevealGuardState,
  binding: SearchRevealBinding,
): SearchRevealSettlement {
  const request = state.pending
  if (!request) return { state, request: null }

  if (request.requestId <= state.lastHandledRequestId) {
    return { state: { ...state, pending: null }, request: null }
  }
  if (
    binding.currentTabId !== request.tabId
    || binding.consumerMode !== request.mode
    || binding.activeMode !== request.mode
  ) {
    return { state: { ...state, pending: null }, request: null }
  }
  if (binding.boundTabId !== request.tabId) return { state, request: null }

  return {
    state: { pending: null, lastHandledRequestId: request.requestId },
    request,
  }
}

function finiteInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Convert 1-based Unicode-scalar search coordinates into both editor cursor
 * formats. Invalid/out-of-range values are clamped to a valid document range.
 */
export function searchCoordinatesToEditorRange(
  markdown: string,
  coordinates: SearchRevealCoordinates,
): EditorSearchRange {
  const rawLines = markdown.split('\n')
  const requestedLine = Math.max(1, finiteInteger(coordinates.line, 1))
  const line = clamp(requestedLine - 1, 0, rawLines.length - 1)
  const rawLine = rawLines[line] ?? ''
  // Search previews omit CR/LF, so never allow a result selection to include
  // the CR half of a CRLF line ending if one reaches the renderer unchanged.
  const lineText = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
  const characters = Array.from(lineText)
  const requestedColumn = Math.max(1, finiteInteger(coordinates.column, 1))
  const startCharacter = clamp(requestedColumn - 1, 0, characters.length)
  const requestedLength = Math.max(0, finiteInteger(coordinates.length, 0))
  const endCharacter = clamp(startCharacter + requestedLength, startCharacter, characters.length)
  const startCh = characters.slice(0, startCharacter).join('').length
  const endCh = characters.slice(0, endCharacter).join('').length

  let lineStart = 0
  for (let index = 0; index < line; index += 1) {
    lineStart += (rawLines[index]?.length ?? 0) + 1
  }

  return {
    line,
    startCh,
    endCh,
    from: lineStart + startCh,
    to: lineStart + endCh,
  }
}
