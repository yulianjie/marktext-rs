export type FixedEditorShortcutAction =
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.selectAll'
  | 'paragraph.h1'
  | 'paragraph.h2'
  | 'paragraph.h3'
  | 'paragraph.h4'
  | 'paragraph.h5'
  | 'paragraph.h6'
  | 'format.bold'
  | 'format.italic'
  | 'format.strikethrough'
  | 'format.inlineCode'
  | 'format.link'
  | 'format.image'

const FIXED_EDITOR_SHORTCUTS: Readonly<Record<string, FixedEditorShortcutAction>> = Object.freeze({
  'ctrl+z': 'edit.undo',
  'ctrl+shift+z': 'edit.redo',
  'ctrl+a': 'edit.selectAll',
  'ctrl+1': 'paragraph.h1',
  'ctrl+2': 'paragraph.h2',
  'ctrl+3': 'paragraph.h3',
  'ctrl+4': 'paragraph.h4',
  'ctrl+5': 'paragraph.h5',
  'ctrl+6': 'paragraph.h6',
  'ctrl+b': 'format.bold',
  'ctrl+i': 'format.italic',
  'ctrl+d': 'format.strikethrough',
  'ctrl+`': 'format.inlineCode',
  'ctrl+l': 'format.link',
  'ctrl+shift+i': 'format.image',
})

/** Resolve a canonical accelerator produced by `eventAccel`. */
export function resolveFixedEditorShortcut(
  accelerator: string,
  isMac: boolean,
): FixedEditorShortcutAction | null {
  if (accelerator === 'ctrl+y') return isMac ? null : 'edit.redo'
  return FIXED_EDITOR_SHORTCUTS[accelerator] ?? null
}

/** Fixed editor commands only run while Muya or CodeMirror owns the key event. */
export function isEditorShortcutTarget(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined'
    && target instanceof Element
    && Boolean(target.closest('[data-editor-shortcut-scope="true"]'))
}

export function isTextEditingTarget(target: Element | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) {
    return !new Set([
      'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
    ]).has(target.type.toLowerCase())
  }
  return target.isContentEditable
}
