/** Renderer-side user-overridable keyboard shortcuts. */
import { defineStore } from 'pinia'
import {
  defaultKeybindings as registryDefaultKeybindings,
  isReservedAccelerator,
  isShortcutRemappable,
  isSupportedShortcutKey,
  normaliseAccelerator,
  serialiseAccelerator,
  splitAccelerator,
} from '@/common/shortcut-registry'
import { setPreference } from '@/services/tauri-invoke'

/** Kept as a store export for existing Preferences and command-palette users. */
export const defaultKeybindings = registryDefaultKeybindings
export { eventAccel, normalise } from '@/common/shortcut-registry'

export type KeybindingValidation =
  | { ok: true; normalized: string }
  | {
      ok: false
      code: 'unknown-action' | 'invalid' | 'modifier-required' | 'conflict' | 'reserved'
      message: string
      conflictWith?: string
    }

export type KeybindingUpdateResult = KeybindingValidation | {
  ok: false
  code: 'persist-failed'
  message: string
}

const writeQueues = new WeakMap<object, Promise<void>>()
const confirmedMaps = new WeakMap<object, Record<string, string>>()
const pendingCounts = new WeakMap<object, number>()

function markPending(owner: { saving: boolean }, delta: 1 | -1): void {
  const count = Math.max(0, (pendingCounts.get(owner) ?? 0) + delta)
  pendingCounts.set(owner, count)
  owner.saving = count > 0
}

function cloneMap(map: Record<string, string>): Record<string, string> {
  return { ...map }
}

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key])
}

function enqueue(owner: object, operation: () => Promise<KeybindingUpdateResult>): Promise<KeybindingUpdateResult> {
  const previous = writeQueues.get(owner) ?? Promise.resolve()
  const result = previous.then(operation, operation)
  writeQueues.set(owner, result.then(() => undefined, () => undefined))
  return result
}

export function validateKeybinding(
  map: Record<string, string>,
  actionId: string,
  accel: string,
): KeybindingValidation {
  if (!isShortcutRemappable(actionId) || !(actionId in map)) {
    return { ok: false, code: 'unknown-action', message: `Unknown action: ${actionId}` }
  }
  const shape = validateKeybindingShape(accel)
  if (!shape.ok) return shape
  const normalized = normaliseAccelerator(shape.normalized)
  if (isReservedAccelerator(normalized)) {
    return {
      ok: false,
      code: 'reserved',
      message: 'This shortcut is reserved by a fixed application command.',
    }
  }
  for (const [otherId, otherAccel] of Object.entries(map)) {
    if (otherId !== actionId && normaliseAccelerator(otherAccel) === normalized) {
      return {
        ok: false,
        code: 'conflict',
        message: `This shortcut is already assigned to ${otherId}.`,
        conflictWith: otherId,
      }
    }
  }
  return shape
}

function validateKeybindingShape(accel: string): KeybindingValidation {
  const normalized = normaliseAccelerator(accel)
  const tokens = splitAccelerator(normalized).filter(Boolean)
  const modifiers = new Set(['ctrl', 'shift', 'alt'])
  const keys = tokens.filter(token => !modifiers.has(token))
  if (!normalized || keys.length !== 1 || new Set(tokens).size !== tokens.length) {
    return { ok: false, code: 'invalid', message: 'Press exactly one key with optional modifiers.' }
  }
  const key = keys[0]
  if (!isSupportedShortcutKey(key)) {
    return { ok: false, code: 'invalid', message: `Unsupported shortcut key: ${key}` }
  }
  const hasCommandModifier = tokens.some(token => token === 'ctrl' || token === 'alt')
  if (!hasCommandModifier) {
    return {
      ok: false,
      code: 'modifier-required',
      message: 'Printable shortcuts must include Ctrl, Cmd, or Alt.',
    }
  }
  return { ok: true, normalized: serialiseAccelerator(normalized) }
}

/**
 * Complete an old or partial persisted map without ever manufacturing an
 * unassigned action. Persisted values win when they are individually valid;
 * every remaining action first tries its own default, then an otherwise-unused
 * registry default. This makes a partial `New = Ctrl+O` deterministic: Open
 * receives the now-free `Ctrl+T`, while a full New/Open swap remains intact.
 *
 * Keep the allocation order in lockstep with
 * `menu::keybindings_from_value` in Rust. The renderer stores logical Ctrl
 * spellings; the native layer translates that primary modifier to Cmd on macOS
 * only when constructing a menu accelerator.
 */
export function normaliseKeybindingMap(
  persisted: Record<string, unknown> | undefined | null,
): Record<string, string> {
  const actionIds = Object.keys(defaultKeybindings)
  const next: Record<string, string> = {}
  const used = new Set<string>()

  const add = (actionId: string, accelerator: string): boolean => {
    const normalized = normaliseAccelerator(accelerator)
    if (!normalized || used.has(normalized)) return false
    next[actionId] = accelerator
    used.add(normalized)
    return true
  }

  // A legacy map may be partial, but valid explicit choices take precedence
  // over defaults. Duplicate legacy choices are resolved by declaration order.
  for (const actionId of actionIds) {
    const raw = persisted?.[actionId]
    if (typeof raw !== 'string') continue
    const validation = validateKeybindingShape(raw)
    if (!validation.ok || isReservedAccelerator(validation.normalized)) continue
    add(actionId, validation.normalized)
  }

  // Preserve each remaining action's own default whenever it is still free.
  for (const actionId of actionIds) {
    if (actionId in next) continue
    add(actionId, defaultKeybindings[actionId])
  }

  // An explicit remap can occupy another action's default. The registry
  // defaults are unique, so this final pass always has a safe value available
  // for every unassigned action.
  const fallbackDefaults = actionIds.map(actionId => defaultKeybindings[actionId])
  for (const actionId of actionIds) {
    if (actionId in next) continue
    const fallback = fallbackDefaults.find(accelerator => !used.has(normaliseAccelerator(accelerator)))
    if (!fallback || !add(actionId, fallback)) {
      throw new Error(`Shortcut registry cannot assign a binding for ${actionId}.`)
    }
  }

  return next
}

export const useKeybindingsStore = defineStore('keybindings', {
  state: () => ({
    map: cloneMap(defaultKeybindings),
    saving: false,
    lastError: null as string | null,
    revision: 0,
  }),

  actions: {
    validate(actionId: string, accel: string): KeybindingValidation {
      return validateKeybinding(this.map, actionId, accel)
    },

    /** Apply a persisted/cross-window map. Invalid, conflicting, and unknown
     * entries are ignored so one bad shortcut cannot disable another action. */
    hydrate(persisted: Record<string, unknown> | undefined | null) {
      if (!persisted) return
      this.revision += 1
      const next = normaliseKeybindingMap(persisted)
      this.map = next
      confirmedMaps.set(this, cloneMap(next))
      this.lastError = null
    },

    async set(actionId: string, accel: string): Promise<KeybindingUpdateResult> {
      markPending(this, 1)

      return enqueue(this, async () => {
        const validation = this.validate(actionId, accel)
        if (!validation.ok) {
          this.lastError = validation.message
          markPending(this, -1)
          return validation
        }
        // Build from the confirmed map at execution time. A queued edit must
        // not smuggle an earlier failed optimistic edit into its full-map
        // persistence payload.
        const candidate = { ...this.map, [actionId]: validation.normalized }
        this.map = candidate
        const revision = this.revision
        try {
          await setPreference('keybindings', candidate)
          if (revision === this.revision) confirmedMaps.set(this, cloneMap(candidate))
          this.lastError = null
          return validation
        } catch (error) {
          if (sameMap(this.map, candidate)) {
            this.map = cloneMap(confirmedMaps.get(this) ?? defaultKeybindings)
          }
          const result: KeybindingUpdateResult = {
            ok: false,
            code: 'persist-failed',
            message: error instanceof Error ? error.message : String(error),
          }
          this.lastError = result.message
          return result
        } finally {
          markPending(this, -1)
        }
      })
    },

    async resetAll(): Promise<KeybindingUpdateResult> {
      markPending(this, 1)
      return enqueue(this, async () => {
        const candidate = cloneMap(defaultKeybindings)
        this.map = candidate
        const revision = this.revision
        try {
          await setPreference('keybindings', candidate)
          if (revision === this.revision) confirmedMaps.set(this, cloneMap(candidate))
          this.lastError = null
          return { ok: true, normalized: '' }
        } catch (error) {
          if (sameMap(this.map, candidate)) {
            this.map = cloneMap(confirmedMaps.get(this) ?? defaultKeybindings)
          }
          const result: KeybindingUpdateResult = {
            ok: false,
            code: 'persist-failed',
            message: error instanceof Error ? error.message : String(error),
          }
          this.lastError = result.message
          return result
        } finally {
          markPending(this, -1)
        }
      })
    },
  },

  getters: {
    accel: state => (actionId: string): string | undefined => state.map[actionId],
    defaults: () => defaultKeybindings,
    byAccel: state => {
      const out: Record<string, string> = {}
      for (const [id, accel] of Object.entries(state.map)) {
        const normalized = normaliseAccelerator(accel)
        // Malformed external state must never turn a lone Ctrl/Shift/Alt
        // event (whose accelerator is also empty) into an application action.
        if (normalized) out[normalized] = id
      }
      return out
    },
  },
})
