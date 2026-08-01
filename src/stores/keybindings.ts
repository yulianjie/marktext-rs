/** Renderer-side user-overridable keyboard shortcuts. */
import { defineStore } from 'pinia'
import { setPreference } from '@/services/tauri-invoke'

export const defaultKeybindings: Readonly<Record<string, string>> = Object.freeze({
  'file.new': 'Ctrl+T',
  'file.open': 'Ctrl+O',
  'file.openFolder': 'Ctrl+Shift+O',
  'file.save': 'Ctrl+S',
  'file.saveAs': 'Ctrl+Shift+S',
  'file.closeTab': 'Ctrl+W',
  'file.print': 'Ctrl+P',
  'edit.find': 'Ctrl+F',
  'edit.replace': 'Ctrl+H',
  'view.toggleSidebar': 'Ctrl+Shift+B',
  'view.commandPalette': 'Ctrl+Shift+P',
})

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

const reservedAccelerators = new Set([
  // Predefined Edit/Application menu actions.
  'ctrl+z', 'ctrl+y', 'ctrl+shift+z', 'ctrl+x', 'ctrl+c', 'ctrl+v', 'ctrl+a', 'ctrl+q',
  // Fixed document-format/view/window actions.
  'ctrl+shift+n', 'ctrl+shift+w', 'ctrl+1', 'ctrl+2', 'ctrl+3', 'ctrl+4', 'ctrl+5',
  'ctrl+6', 'ctrl+b', 'ctrl+i', 'ctrl+d', 'ctrl+`', 'ctrl+l', 'ctrl+shift+i',
  'ctrl+alt+s', 'ctrl+=', 'ctrl+-', 'ctrl+0', 'ctrl+,',
])

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

function displayAccel(accel: string): string {
  const tokens = normalise(accel).split('+').filter(Boolean)
  const labels: Record<string, string> = {
    ctrl: 'Ctrl',
    cmd: 'Cmd',
    shift: 'Shift',
    alt: 'Alt',
    esc: 'Esc',
    space: 'Space',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
  }
  return tokens.map(token => labels[token] ?? (token.length === 1 ? token.toUpperCase() : token)).join('+')
}

export function validateKeybinding(
  map: Record<string, string>,
  actionId: string,
  accel: string,
): KeybindingValidation {
  if (!(actionId in map)) {
    return { ok: false, code: 'unknown-action', message: `Unknown action: ${actionId}` }
  }
  const shape = validateKeybindingShape(accel)
  if (!shape.ok) return shape
  const normalized = normalise(shape.normalized)
  if (reservedAccelerators.has(normalized)) {
    return {
      ok: false,
      code: 'reserved',
      message: 'This shortcut is reserved by a fixed application command.',
    }
  }
  for (const [otherId, otherAccel] of Object.entries(map)) {
    if (otherId !== actionId && normalise(otherAccel) === normalized) {
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
  const normalized = normalise(accel)
  const tokens = normalized.split('+').filter(Boolean)
  const modifiers = new Set(['ctrl', 'shift', 'alt'])
  const keys = tokens.filter(token => !modifiers.has(token))
  if (!normalized || keys.length !== 1 || new Set(tokens).size !== tokens.length) {
    return { ok: false, code: 'invalid', message: 'Press exactly one key with optional modifiers.' }
  }
  const key = keys[0]
  if (!isSupportedKey(key)) {
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
  return { ok: true, normalized: displayAccel(normalized) }
}

function isSupportedKey(key: string): boolean {
  if (/^[a-z0-9]$/.test(key) || "`\\[],=-.';/".includes(key)) return true
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(key)) return true
  return new Set([
    'esc', 'space', 'backspace', 'capslock', 'enter', 'tab', 'delete', 'end',
    'home', 'insert', 'pagedown', 'pageup', 'printscreen', 'scrolllock',
    'up', 'down', 'left', 'right', 'numlock', 'volumedown', 'volumeup',
    'volumemute',
  ]).has(key) || /^(?:numpad|num)(?:[0-9]|add|plus|decimal|divide|enter|equal|multiply|subtract)$/.test(key)
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
      const desired: Record<string, string> = {}
      for (const actionId of Object.keys(defaultKeybindings)) {
        const value = persisted[actionId]
        const validation = validateKeybindingShape(
          typeof value === 'string' ? value : defaultKeybindings[actionId],
        )
        desired[actionId] = validation.ok && !reservedAccelerators.has(normalise(validation.normalized))
          ? validation.normalized
          : defaultKeybindings[actionId]
      }

      // Validate the completed persisted map, rather than each entry against
      // the defaults. This preserves legitimate swaps such as exchanging the
      // shortcuts for New and Open across a restart.
      const counts = new Map<string, number>()
      for (const accel of Object.values(desired)) {
        const normalized = normalise(accel)
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
      }
      const next: Record<string, string> = {}
      const used = new Set<string>()
      for (const actionId of Object.keys(defaultKeybindings)) {
        const accel = desired[actionId]
        const normalized = normalise(accel)
        if (counts.get(normalized) === 1) {
          next[actionId] = accel
          used.add(normalized)
        }
      }
      for (const actionId of Object.keys(defaultKeybindings)) {
        if (actionId in next) continue
        const fallback = defaultKeybindings[actionId]
        const normalized = normalise(fallback)
        next[actionId] = used.has(normalized) ? '' : fallback
        if (next[actionId]) used.add(normalized)
      }
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
      for (const [id, accel] of Object.entries(state.map)) out[normalise(accel)] = id
      return out
    },
  },
})

/** Normalise an accelerator into a canonical comparison form. */
export function normalise(accel: string): string {
  return accel
    .split('+')
    .map(value => {
      const token = value.trim().toLowerCase()
      const aliases: Record<string, string> = {
        control: 'ctrl',
        cmd: 'ctrl',
        command: 'ctrl',
        meta: 'ctrl',
        cmdorctrl: 'ctrl',
        commandorcontrol: 'ctrl',
        option: 'alt',
        escape: 'esc',
        arrowup: 'up',
        arrowdown: 'down',
        arrowleft: 'left',
        arrowright: 'right',
        '+': '=',
        '_': '-',
        '{': '[',
        '}': ']',
        '|': '\\',
        ':': ';',
        '"': "'",
        '<': ',',
        '>': '.',
        '?': '/',
        '~': '`',
      }
      return aliases[token] ?? token
    })
    .filter(Boolean)
    .sort((a, b) => {
      const order = ['ctrl', 'cmd', 'shift', 'alt']
      const ai = order.indexOf(a)
      const bi = order.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    .join('+')
}

/** Compute the canonical accelerator for a KeyboardEvent. */
export function eventAccel(ev: KeyboardEvent): string {
  const parts: string[] = []
  // The native menu treats Ctrl/Cmd as the platform primary modifier, so the
  // renderer stores both under one canonical token for conflict detection.
  if (ev.ctrlKey || ev.metaKey) parts.push('Ctrl')
  if (ev.shiftKey) parts.push('Shift')
  if (ev.altKey) parts.push('Alt')
  const names: Record<string, string> = {
    ' ': 'Space',
    Escape: 'Esc',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  }
  const codeKey = /^(?:Key[A-Z]|Digit[0-9])$/.test(ev.code)
    ? ev.code.replace(/^Key/, '').replace(/^Digit/, '')
    : undefined
  const key = codeKey ?? names[ev.key] ?? (ev.key.length === 1 ? ev.key.toUpperCase() : ev.key)
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(ev.key)) parts.push(key)
  return normalise(parts.join('+'))
}
