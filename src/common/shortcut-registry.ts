import rawShortcutRegistry from './shortcut-registry.json'

/** The context which owns dispatch for a registered shortcut. */
export type ShortcutScope = 'application' | 'editor' | 'agent' | 'titlebar'

/** Whether a shortcut can run in the current editor/chrome state. */
export type ShortcutAvailability = 'always' | 'editor' | 'wysiwyg' | 'source' | 'custom-chrome'

/** The component which consumes the action after its accelerator is resolved. */
export type ShortcutDispatch = 'application' | 'editor' | 'native' | 'system' | 'agent' | 'titlebar'

/** Platform-specific alternate accelerators supplement the cross-platform default. */
export type ShortcutPlatform = 'windows' | 'macos' | 'linux'

export interface ShortcutAction {
  readonly id: string
  readonly display: string
  readonly scope: ShortcutScope
  readonly availability: ShortcutAvailability
  readonly dispatch: ShortcutDispatch
  readonly remappable: boolean
  readonly default: string
  readonly platformAlternatives: Readonly<Partial<Record<ShortcutPlatform, readonly string[]>>>
  readonly reserved: boolean
  /** Native OS behavior (for example macOS Quit), not a renderer command. */
  readonly systemOwned: boolean
  /** Empty means all supported platforms; otherwise the shortcut exists only here. */
  readonly platforms: readonly ShortcutPlatform[]
}

export interface ShortcutRegistry {
  readonly version: number
  readonly actions: readonly ShortcutAction[]
}

export interface ShortcutQuery {
  readonly scope?: ShortcutScope
  readonly availability?: ShortcutAvailability
  readonly dispatch?: ShortcutDispatch
  readonly remappable?: boolean
  readonly reserved?: boolean
}

export interface ShortcutAvailabilityContext {
  readonly hasEditor?: boolean
  readonly sourceCodeMode?: boolean
  readonly customChrome?: boolean
}

export interface ShortcutResolutionQuery extends ShortcutQuery {
  readonly platform?: ShortcutPlatform
}

const shortcutScopes = new Set<ShortcutScope>(['application', 'editor', 'agent', 'titlebar'])
const shortcutAvailabilities = new Set<ShortcutAvailability>(['always', 'editor', 'wysiwyg', 'source', 'custom-chrome'])
const shortcutDispatches = new Set<ShortcutDispatch>(['application', 'editor', 'native', 'system', 'agent', 'titlebar'])
const shortcutPlatforms = new Set<ShortcutPlatform>(['windows', 'macos', 'linux'])
const modifierOrder = ['ctrl', 'shift', 'alt'] as const

const acceleratorAliases: Readonly<Record<string, string>> = Object.freeze({
  control: 'ctrl',
  cmd: 'ctrl',
  command: 'ctrl',
  meta: 'ctrl',
  cmdorctrl: 'ctrl',
  commandorcontrol: 'ctrl',
  option: 'alt',
  escape: 'esc',
  esc: 'esc',
  spacebar: 'space',
  return: 'enter',
  del: 'delete',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  plus: '=',
  '+': '=',
  underscore: '-',
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
  num0: 'numpad0',
  num1: 'numpad1',
  num2: 'numpad2',
  num3: 'numpad3',
  num4: 'numpad4',
  num5: 'numpad5',
  num6: 'numpad6',
  num7: 'numpad7',
  num8: 'numpad8',
  num9: 'numpad9',
  numadd: 'numpadadd',
  numplus: 'numpadadd',
  numdecimal: 'numpaddecimal',
  numdivide: 'numpaddivide',
  numenter: 'numpadenter',
  numequal: 'numpadequal',
  nummultiply: 'numpadmultiply',
  numsubtract: 'numpadsubtract',
  numminus: 'numpadsubtract',
  numpadplus: 'numpadadd',
  numpadminus: 'numpadsubtract',
  audiovolumedown: 'volumedown',
  audiovolumeup: 'volumeup',
  audiovolumemute: 'volumemute',
})

const eventCodeKeys: Readonly<Record<string, string>> = Object.freeze({
  Space: 'space',
  Escape: 'esc',
  Enter: 'enter',
  Tab: 'tab',
  Backspace: 'backspace',
  CapsLock: 'capslock',
  Delete: 'delete',
  End: 'end',
  Home: 'home',
  Insert: 'insert',
  PageDown: 'pagedown',
  PageUp: 'pageup',
  PrintScreen: 'printscreen',
  ScrollLock: 'scrolllock',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  NumLock: 'numlock',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Numpad0: 'numpad0',
  Numpad1: 'numpad1',
  Numpad2: 'numpad2',
  Numpad3: 'numpad3',
  Numpad4: 'numpad4',
  Numpad5: 'numpad5',
  Numpad6: 'numpad6',
  Numpad7: 'numpad7',
  Numpad8: 'numpad8',
  Numpad9: 'numpad9',
  NumpadAdd: 'numpadadd',
  NumpadDecimal: 'numpaddecimal',
  NumpadDivide: 'numpaddivide',
  NumpadEnter: 'numpadenter',
  NumpadEqual: 'numpadequal',
  NumpadMultiply: 'numpadmultiply',
  NumpadSubtract: 'numpadsubtract',
  AudioVolumeDown: 'volumedown',
  AudioVolumeUp: 'volumeup',
  AudioVolumeMute: 'volumemute',
})

const namedShortcutKeys = new Set([
  'esc', 'space', 'backspace', 'capslock', 'enter', 'tab', 'delete', 'end',
  'home', 'insert', 'pagedown', 'pageup', 'printscreen', 'scrolllock',
  'up', 'down', 'left', 'right', 'numlock', 'volumedown', 'volumeup',
  'volumemute',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid shortcut registry: ${field} must be a non-empty string.`)
  }
  return value
}

function expectBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid shortcut registry: ${field} must be a boolean.`)
  }
  return value
}

function parsePlatformAlternatives(value: unknown, actionId: string): ShortcutAction['platformAlternatives'] {
  if (value === undefined) return Object.freeze({})
  if (!isRecord(value)) {
    throw new Error(`Invalid shortcut registry: ${actionId}.platformAlternatives must be an object.`)
  }

  const alternatives: Partial<Record<ShortcutPlatform, readonly string[]>> = {}
  for (const [platform, accelerators] of Object.entries(value)) {
    if (!shortcutPlatforms.has(platform as ShortcutPlatform)) {
      throw new Error(`Invalid shortcut registry: unknown platform ${platform} for ${actionId}.`)
    }
    if (!Array.isArray(accelerators) || accelerators.some(accelerator => typeof accelerator !== 'string' || !accelerator.trim())) {
      throw new Error(`Invalid shortcut registry: ${actionId}.${platform} alternatives must be strings.`)
    }
    alternatives[platform as ShortcutPlatform] = Object.freeze([...accelerators])
  }
  return Object.freeze(alternatives)
}

function parsePlatforms(value: unknown, actionId: string): ShortcutAction['platforms'] {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value) || value.some(platform => !shortcutPlatforms.has(platform as ShortcutPlatform))) {
    throw new Error(`Invalid shortcut registry: ${actionId}.platforms must contain known platforms.`)
  }
  const platforms = value as ShortcutPlatform[]
  if (new Set(platforms).size !== platforms.length) {
    throw new Error(`Invalid shortcut registry: ${actionId}.platforms must not contain duplicates.`)
  }
  return Object.freeze([...platforms])
}

function parseShortcutAction(value: unknown, index: number): ShortcutAction {
  if (!isRecord(value)) throw new Error(`Invalid shortcut registry: actions[${index}] must be an object.`)
  const id = expectText(value.id, `actions[${index}].id`)
  const scope = expectText(value.scope, `${id}.scope`) as ShortcutScope
  const availability = expectText(value.availability, `${id}.availability`) as ShortcutAvailability
  const dispatch = expectText(value.dispatch, `${id}.dispatch`) as ShortcutDispatch
  if (!shortcutScopes.has(scope)) throw new Error(`Invalid shortcut registry: unknown scope ${scope} for ${id}.`)
  if (!shortcutAvailabilities.has(availability)) throw new Error(`Invalid shortcut registry: unknown availability ${availability} for ${id}.`)
  if (!shortcutDispatches.has(dispatch)) throw new Error(`Invalid shortcut registry: unknown dispatch ${dispatch} for ${id}.`)

  const systemOwned = value.systemOwned === undefined
    ? false
    : expectBoolean(value.systemOwned, `${id}.systemOwned`)
  const platforms = parsePlatforms(value.platforms, id)
  if (systemOwned !== (dispatch === 'system')) {
    throw new Error(`Invalid shortcut registry: ${id} system ownership must match system dispatch.`)
  }

  return Object.freeze({
    id,
    display: expectText(value.display, `${id}.display`),
    scope,
    availability,
    dispatch,
    remappable: expectBoolean(value.remappable, `${id}.remappable`),
    default: expectText(value.default, `${id}.default`),
    platformAlternatives: parsePlatformAlternatives(value.platformAlternatives, id),
    reserved: expectBoolean(value.reserved, `${id}.reserved`),
    systemOwned,
    platforms,
  })
}

function parseShortcutRegistry(value: unknown): ShortcutRegistry {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.actions)) {
    throw new Error('Invalid shortcut registry document.')
  }
  const actions = value.actions.map(parseShortcutAction)
  const ids = new Set<string>()
  for (const action of actions) {
    if (ids.has(action.id)) throw new Error(`Invalid shortcut registry: duplicate action ${action.id}.`)
    ids.add(action.id)
  }
  return Object.freeze({ version: value.version, actions: Object.freeze(actions) })
}

/** The single renderer-readable source of truth for shortcut declarations. */
export const shortcutRegistry = parseShortcutRegistry(rawShortcutRegistry)
export const shortcutActions = shortcutRegistry.actions

const actionsById = new Map(shortcutActions.map(action => [action.id, action]))
const remappableActions = Object.freeze(shortcutActions.filter(action => action.remappable))

/** Split a human-readable accelerator without losing a literal `+` key. */
export function splitAccelerator(accelerator: string): string[] {
  const tokens: string[] = []
  let current = ''
  for (const character of accelerator.trim()) {
    if (character !== '+') {
      current += character
      continue
    }
    const token = current.trim()
    if (token) {
      tokens.push(token)
      current = ''
    } else {
      // A second separator is the literal plus key: Ctrl++ → Ctrl + +.
      tokens.push('+')
    }
  }
  const trailing = current.trim()
  if (trailing) tokens.push(trailing)
  return tokens
}

function normaliseKeyToken(token: string): string {
  const lower = token.trim().toLowerCase()
  return acceleratorAliases[lower] ?? lower
}

/** Normalise an accelerator into a canonical comparison form. */
export function normaliseAccelerator(accelerator: string): string {
  return splitAccelerator(accelerator)
    .map(normaliseKeyToken)
    .filter(Boolean)
    .sort((a, b) => {
      const ai = modifierOrder.indexOf(a as typeof modifierOrder[number])
      const bi = modifierOrder.indexOf(b as typeof modifierOrder[number])
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    .join('+')
}

/** Backwards-compatible concise spelling used by existing renderer callers. */
export const normalise = normaliseAccelerator

/** Render a canonical accelerator for preferences and accessible UI labels. */
export function displayAccelerator(
  accelerator: string,
  platform: ShortcutPlatform | undefined = currentShortcutPlatform(),
): string {
  const labels: Readonly<Record<string, string>> = {
    ctrl: platform === 'macos' ? 'Cmd' : 'Ctrl',
    shift: 'Shift',
    alt: 'Alt',
    esc: 'Esc',
    space: 'Space',
    backspace: 'Backspace',
    capslock: 'Caps Lock',
    enter: 'Enter',
    tab: 'Tab',
    delete: 'Delete',
    end: 'End',
    home: 'Home',
    insert: 'Insert',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    pagedown: 'Page Down',
    pageup: 'Page Up',
    printscreen: 'Print Screen',
    scrolllock: 'Scroll Lock',
    numlock: 'Num Lock',
    volumedown: 'Volume Down',
    volumeup: 'Volume Up',
    volumemute: 'Volume Mute',
  }
  return splitAccelerator(normaliseAccelerator(accelerator))
    .map(token => labels[token]
      ?? formatNumpadKey(token)
      ?? (/^f(?:[1-9]|1\d|2[0-4])$/.test(token) ? token.toUpperCase() : undefined)
      ?? (token.length === 1 ? token.toUpperCase() : token))
    .join('+')
}

/**
 * Produce a persistence/native-menu-safe spelling. Unlike the human display
 * label, this never embeds a literal `+` inside a token (for example,
 * `NumpadAdd` instead of `Numpad +`).
 */
export function serialiseAccelerator(accelerator: string): string {
  const labels: Readonly<Record<string, string>> = {
    ctrl: 'Ctrl',
    shift: 'Shift',
    alt: 'Alt',
    esc: 'Esc',
    space: 'Space',
    backspace: 'Backspace',
    capslock: 'CapsLock',
    enter: 'Enter',
    tab: 'Tab',
    delete: 'Delete',
    end: 'End',
    home: 'Home',
    insert: 'Insert',
    pagedown: 'PageDown',
    pageup: 'PageUp',
    printscreen: 'PrintScreen',
    scrolllock: 'ScrollLock',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    numlock: 'NumLock',
    volumedown: 'VolumeDown',
    volumeup: 'VolumeUp',
    volumemute: 'VolumeMute',
  }
  return splitAccelerator(normaliseAccelerator(accelerator))
    .map(token => labels[token]
      ?? serialiseNumpadKey(token)
      ?? (/^f(?:[1-9]|1\d|2[0-4])$/.test(token) ? token.toUpperCase() : undefined)
      ?? (token.length === 1 ? token.toUpperCase() : token))
    .join('+')
}

function formatNumpadKey(key: string): string | undefined {
  const digit = /^numpad([0-9])$/.exec(key)?.[1]
  if (digit) return `Numpad ${digit}`
  const labels: Readonly<Record<string, string>> = {
    numpadadd: 'Numpad +',
    numpaddecimal: 'Numpad .',
    numpaddivide: 'Numpad /',
    numpadenter: 'Numpad Enter',
    numpadequal: 'Numpad =',
    numpadmultiply: 'Numpad *',
    numpadsubtract: 'Numpad -',
  }
  return labels[key]
}

function serialiseNumpadKey(key: string): string | undefined {
  const digit = /^numpad([0-9])$/.exec(key)?.[1]
  if (digit) return `Numpad${digit}`
  const labels: Readonly<Record<string, string>> = {
    numpadadd: 'NumpadAdd',
    numpaddecimal: 'NumpadDecimal',
    numpaddivide: 'NumpadDivide',
    numpadenter: 'NumpadEnter',
    numpadequal: 'NumpadEqual',
    numpadmultiply: 'NumpadMultiply',
    numpadsubtract: 'NumpadSubtract',
  }
  return labels[key]
}

/** Whether the final (non-modifier) key is supported by the recorder. */
export function isSupportedShortcutKey(key: string): boolean {
  const normalized = normaliseKeyToken(key)
  if (/^[a-z0-9]$/.test(normalized) || "`\\[],=-.';/".includes(normalized)) return true
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(normalized)) return true
  if (/^numpad(?:[0-9]|add|decimal|divide|enter|equal|multiply|subtract)$/.test(normalized)) return true
  return namedShortcutKeys.has(normalized)
}

function eventShortcutKey(event: KeyboardEvent): string | undefined {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return undefined
  const codeKey = eventCodeKeys[event.code]
  if (codeKey) return codeKey
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  return normaliseKeyToken(event.key)
}

/**
 * Compute the canonical accelerator for a KeyboardEvent.
 *
 * Numpad keys retain their distinct identity, media keys use recorder-safe
 * names, and Ctrl++ is represented as Ctrl+= (the native accelerator form).
 */
export function eventAccel(event: KeyboardEvent, platform?: ShortcutPlatform): string {
  // AltGr is usually reported as Ctrl+Alt. It produces a printable character,
  // not an application shortcut, so no renderer key router may claim it.
  if (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')) return ''
  const key = eventShortcutKey(event)
  if (!key) return ''

  const parts: string[] = []
  const resolvedPlatform = platform ?? currentShortcutPlatform()
  const primary = resolvedPlatform === 'macos'
    ? event.metaKey
    : resolvedPlatform
      ? event.ctrlKey
      : event.ctrlKey || event.metaKey
  if (primary) parts.push('Ctrl')
  // `+` is the shifted form of the Equal key. Native menus describe that
  // shortcut as Ctrl+=, so do not add a second, implicit Shift modifier.
  const plusOnEqualKey = event.code === 'Equal' && event.key === '+'
  if (event.shiftKey && !plusOnEqualKey) parts.push('Shift')
  if (event.altKey) parts.push('Alt')
  parts.push(key)
  return normaliseAccelerator(parts.join('+'))
}

function asShortcutAction(actionOrId: ShortcutAction | string | undefined): ShortcutAction | undefined {
  return typeof actionOrId === 'string' ? actionsById.get(actionOrId) : actionOrId
}

/** Return the declared action, if any. */
export function getShortcutAction(id: string): ShortcutAction | undefined {
  return actionsById.get(id)
}

/** Query declared actions without consumers needing to know JSON layout. */
export function findShortcutActions(query: ShortcutQuery = {}): readonly ShortcutAction[] {
  return shortcutActions.filter(action => (
    (query.scope === undefined || action.scope === query.scope)
    && (query.availability === undefined || action.availability === query.availability)
    && (query.dispatch === undefined || action.dispatch === query.dispatch)
    && (query.remappable === undefined || action.remappable === query.remappable)
    && (query.reserved === undefined || action.reserved === query.reserved)
  ))
}

/** Return a fixed/default accelerator exactly as declared in the registry. */
export function getShortcutDefault(actionOrId: ShortcutAction | string): string | undefined {
  return asShortcutAction(actionOrId)?.default
}

/** Return the default plus any alternate accelerator valid on a platform. */
export function getShortcutAccelerators(
  actionOrId: ShortcutAction | string,
  platform?: ShortcutPlatform,
): readonly string[] {
  const action = asShortcutAction(actionOrId)
  if (!action) return []
  if (platform && !isShortcutSupportedOnPlatform(action, platform)) return []
  const alternatives = platform
    ? action.platformAlternatives[platform] ?? []
    : Object.values(action.platformAlternatives).flat()
  return Object.freeze([...new Set([action.default, ...alternatives])])
}

export function getShortcutScope(actionOrId: ShortcutAction | string): ShortcutScope | undefined {
  return asShortcutAction(actionOrId)?.scope
}

export function getShortcutAvailability(actionOrId: ShortcutAction | string): ShortcutAvailability | undefined {
  return asShortcutAction(actionOrId)?.availability
}

export function getShortcutDispatch(actionOrId: ShortcutAction | string): ShortcutDispatch | undefined {
  return asShortcutAction(actionOrId)?.dispatch
}

export function getShortcutDisplay(actionOrId: ShortcutAction | string): string | undefined {
  return asShortcutAction(actionOrId)?.display
}

export function isShortcutRemappable(actionOrId: ShortcutAction | string): boolean {
  return asShortcutAction(actionOrId)?.remappable === true
}

export function isShortcutReserved(actionOrId: ShortcutAction | string): boolean {
  return asShortcutAction(actionOrId)?.reserved === true
}

/** Whether this action has a real shortcut on the selected platform. */
export function isShortcutSupportedOnPlatform(
  actionOrId: ShortcutAction | string,
  platform: ShortcutPlatform | undefined = currentShortcutPlatform(),
): boolean {
  const action = asShortcutAction(actionOrId)
  return Boolean(action && (action.platforms.length === 0 || !platform || action.platforms.includes(platform)))
}

/** Check a declaration against runtime editor/chrome state. */
export function isShortcutAvailable(
  actionOrId: ShortcutAction | string,
  context: ShortcutAvailabilityContext = {},
): boolean {
  const availability = getShortcutAvailability(actionOrId)
  switch (availability) {
    case 'always': return true
    case 'editor': return Boolean(context.hasEditor)
    case 'wysiwyg': return Boolean(context.hasEditor) && !context.sourceCodeMode
    case 'source': return Boolean(context.hasEditor) && Boolean(context.sourceCodeMode)
    case 'custom-chrome': return Boolean(context.customChrome)
    default: return false
  }
}

/** Resolve one declared fixed accelerator, including platform alternatives. */
export function resolveShortcutAction(
  accelerator: string,
  query: ShortcutResolutionQuery = {},
): ShortcutAction | undefined {
  const normalized = normaliseAccelerator(accelerator)
  if (!normalized) return undefined
  return findShortcutActions(query).find(action => (
    getShortcutAccelerators(action, query.platform)
      .some(candidate => normaliseAccelerator(candidate) === normalized)
  ))
}

/** Defaults for the only actions which may be changed in Preferences. */
export const defaultKeybindings: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(remappableActions.map(action => [action.id, action.default])),
)

/** Reserved keys include cross-platform alternatives so a saved map is portable. */
export const reservedAccelerators: ReadonlySet<string> = new Set(
  shortcutActions
    .filter(action => action.reserved)
    .flatMap(action => getShortcutAccelerators(action))
    .map(normaliseAccelerator),
)

export function isReservedAccelerator(
  accelerator: string,
  platform: ShortcutPlatform | undefined = currentShortcutPlatform(),
): boolean {
  const normalized = normaliseAccelerator(accelerator)
  if (!normalized) return false
  return shortcutActions.some(action => (
    action.reserved
    && isShortcutSupportedOnPlatform(action, platform)
    && getShortcutAccelerators(action, platform)
      .some(candidate => normaliseAccelerator(candidate) === normalized)
  ))
}

/** Convert the legacy navigator.platform value to registry platform names. */
export function shortcutPlatformFromNavigator(platform: string): ShortcutPlatform | undefined {
  if (/^win/i.test(platform)) return 'windows'
  if (/^mac/i.test(platform)) return 'macos'
  if (/linux/i.test(platform)) return 'linux'
  return undefined
}

/** Runtime platform helper for renderer consumers and tests without a DOM. */
export function currentShortcutPlatform(): ShortcutPlatform | undefined {
  return typeof navigator === 'undefined'
    ? undefined
    : shortcutPlatformFromNavigator(navigator.platform)
}
