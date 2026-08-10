/**
 * Command palette / shortcut registry — port of the legacy `commandCenter`
 * Vuex module.
 *
 * Each command has a stable id, a human description, an optional shortcut
 * (one or more accelerator strings) and an `execute` callback. Components
 * call `register` once on mount; the palette searches over `subcommands`.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { score as fuzzyScore } from 'fuzzaldrin'

export type CommandText = string | (() => string)

export interface Command {
  id: string
  description: CommandText
  category?: CommandText
  categoryOrder?: number
  keywords?: CommandText[]
  shortcut?: string[]
  execute: () => void | Promise<void>
  when?: () => boolean
}

export interface ResolvedCommand extends Omit<Command, 'description' | 'category' | 'keywords'> {
  description: string
  category: string
  keywords: string[]
  disabled: boolean
}

export function normalizeCommandIndex(length: number, index: number): number {
  if (length <= 0) return 0
  return Math.min(Math.max(index, 0), length - 1)
}

export function safeCommandIndex(
  commands: readonly Pick<ResolvedCommand, 'disabled'>[],
  index: number,
): number {
  if (!commands.length) return 0
  const clamped = normalizeCommandIndex(commands.length, index)
  if (!commands[clamped]?.disabled) return clamped
  const firstEnabled = commands.findIndex(command => !command.disabled)
  return firstEnabled === -1 ? clamped : firstEnabled
}

export function nextEnabledCommandIndex(
  commands: readonly Pick<ResolvedCommand, 'disabled'>[],
  index: number,
  delta: -1 | 1,
): number {
  if (!commands.length) return 0
  const current = normalizeCommandIndex(commands.length, index)
  let next = current + delta
  while (next >= 0 && next < commands.length && commands[next]?.disabled) next += delta
  return next >= 0 && next < commands.length ? next : current
}

export const useCommandCenterStore = defineStore('commandCenter', () => {
  const subcommands = ref<Command[]>([])

  const resolveText = (value: CommandText | undefined): string => {
    if (!value) return ''
    return typeof value === 'function' ? value() : value
  }

  const resolved = computed<ResolvedCommand[]>(() => subcommands.value.map(cmd => ({
    ...cmd,
    description: resolveText(cmd.description),
    category: resolveText(cmd.category),
    keywords: (cmd.keywords ?? []).map(resolveText),
    disabled: cmd.when ? !cmd.when() : false,
  })))

  const compareCommands = (a: ResolvedCommand, b: ResolvedCommand): number => {
    const categoryOrder = (a.categoryOrder ?? Number.MAX_SAFE_INTEGER)
      - (b.categoryOrder ?? Number.MAX_SAFE_INTEGER)
    if (categoryOrder) return categoryOrder
    const category = a.category.localeCompare(b.category)
    if (category) return category
    const description = a.description.localeCompare(b.description)
    return description || a.id.localeCompare(b.id)
  }

  const sorted = computed(() => [...resolved.value].sort(compareCommands))

  function register(cmd: Command) {
    const idx = subcommands.value.findIndex(c => c.id === cmd.id)
    if (idx === -1) subcommands.value.push(cmd)
    else subcommands.value.splice(idx, 1, cmd)
  }

  function unregister(id: string) {
    const idx = subcommands.value.findIndex(c => c.id === id)
    if (idx !== -1) subcommands.value.splice(idx, 1)
  }

  async function execute(id: string): Promise<boolean> {
    const cmd = subcommands.value.find(c => c.id === id)
    if (!cmd) {
      console.warn(`[commandCenter] no command with id '${id}'`)
      return false
    }
    if (cmd.when && !cmd.when()) return false
    await cmd.execute()
    return true
  }

  function search(query: string): ResolvedCommand[] {
    const q = query.trim().toLowerCase()
    if (!q) return sorted.value

    return sorted.value
      .map(command => {
        const fields = [command.description, command.id, ...command.keywords]
          .map(field => field.toLowerCase())
        const score = Math.max(...fields.map(field => fuzzyScore(field, q)))
        return { command, score }
      })
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score || compareCommands(a.command, b.command))
      .map(result => result.command)
  }

  return { subcommands, resolved, sorted, register, unregister, execute, search }
})
