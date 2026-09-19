import {
  currentShortcutPlatform,
  eventAccel,
  getShortcutAction,
  isShortcutRemappable,
  type ShortcutPlatform,
} from '@/common/shortcut-registry'

// Keep this ownership rule aligned with menu::renderer_owns_shortcut.
export function rendererOwnsApplicationShortcuts(isTauri: boolean, platform: string): boolean {
  return !isTauri || /^win/i.test(platform)
}

/** Run before editor keymaps can swallow application commands such as Save. */
export function handleApplicationShortcut(
  event: KeyboardEvent,
  bindings: Readonly<Record<string, string>>,
  execute: (action: string) => void,
  platform: ShortcutPlatform | undefined = currentShortcutPlatform(),
): void {
  if (event.defaultPrevented || event.isComposing) return
  const accelerator = eventAccel(event, platform)
  // `eventAccel` deliberately returns an empty string for lone modifier keys.
  // Do not let a malformed externally-supplied map claim that sentinel.
  if (!accelerator) return
  const action = bindings[accelerator]
  const declaration = action ? getShortcutAction(action) : undefined
  if (
    !declaration
    || declaration.scope !== 'application'
    || declaration.dispatch !== 'application'
    || !isShortcutRemappable(declaration)
  ) return
  event.preventDefault()
  event.stopPropagation()
  if (!event.repeat) execute(declaration.id)
}
