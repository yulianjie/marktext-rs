import {
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
  type StateField,
} from '@codemirror/state'

export interface RestorableSourceEditorState {
  markdown: string
  sourceEditorState?: unknown | null
  sourceSelection?: unknown | null
}

export type SourceEditorStateFields = Record<string, StateField<unknown>>

export interface SourceDocumentUpdate {
  docChanged: boolean
  state: { doc: { toString: () => string } }
}

/** Publish only real CodeMirror document transactions to the editor store. */
export function publishSourceDocumentChange(
  update: SourceDocumentUpdate,
  tabId: string | null,
  publish: (tabId: string, markdown: string) => void,
): void {
  if (tabId && update.docChanged) publish(tabId, update.state.doc.toString())
}

function buildState(doc: string, extensions: Extension, selection?: unknown): EditorState {
  let restoredSelection: EditorSelection | undefined
  if (selection) {
    try { restoredSelection = EditorSelection.fromJSON(selection) } catch { /* invalid legacy selection */ }
  }
  return EditorState.create({ doc, selection: restoredSelection, extensions })
}

/**
 * Restore a tab's CodeMirror state without letting stale persisted selection
 * offsets prevent the source editor from mounting. Valid serialized fields
 * (including history) still take the normal `fromJSON` path.
 */
export function restoreSourceEditorState(
  tab: RestorableSourceEditorState,
  extensions: Extension,
  fields: SourceEditorStateFields = {},
): EditorState {
  let state: EditorState
  try {
    state = tab.sourceEditorState
      ? EditorState.fromJSON(tab.sourceEditorState, { extensions }, fields)
      : buildState(tab.markdown, extensions, tab.sourceSelection)
  } catch {
    // `EditorSelection.fromJSON` accepts offsets without knowing the document
    // length. `EditorState.create/fromJSON` performs that check, so retrying
    // with the same selection would simply throw again.
    state = buildState(tab.markdown, extensions)
  }
  if (state.doc.toString() !== tab.markdown) {
    state = state.update({
      changes: { from: 0, to: state.doc.length, insert: tab.markdown },
      annotations: Transaction.addToHistory.of(false),
    }).state
  }
  return state
}
