import {
  isShortcutAvailable,
  resolveShortcutAction,
  type ShortcutAvailabilityContext,
  type ShortcutAction,
} from '@/common/shortcut-registry'

/** Registered ids are strings at runtime; resolution is restricted below. */
export type FixedEditorShortcutAction = ShortcutAction['id']

/** Resolve a canonical accelerator produced by `eventAccel`. */
export function resolveFixedEditorShortcut(
  accelerator: string,
  isMac: boolean,
  context: ShortcutAvailabilityContext = { hasEditor: true },
): FixedEditorShortcutAction | null {
  const declaration = resolveShortcutAction(accelerator, {
    scope: 'editor',
    dispatch: 'editor',
    platform: isMac ? 'macos' : 'windows',
  })
  return declaration && isShortcutAvailable(declaration, context)
    ? declaration.id
    : null
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
