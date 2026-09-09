import { eventAccel } from '@/stores/keybindings'

// Keep this ownership rule aligned with menu::renderer_owns_shortcut.
export function rendererOwnsApplicationShortcuts(isTauri: boolean, platform: string): boolean {
  return !isTauri || /^win/i.test(platform)
}

/** Run before editor keymaps can swallow application commands such as Save. */
export function handleApplicationShortcut(
  event: KeyboardEvent,
  bindings: Readonly<Record<string, string>>,
  execute: (action: string) => void,
): void {
  if (event.defaultPrevented || event.isComposing) return
  const action = bindings[eventAccel(event)]
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  if (!event.repeat) execute(action)
}
