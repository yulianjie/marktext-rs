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

export interface Command {
  id: string
  description: string
  shortcut?: string[]
  execute: () => void | Promise<void>
}

export const useCommandCenterStore = defineStore('commandCenter', () => {
  const subcommands = ref<Command[]>([])

  const sorted = computed(() => [...subcommands.value].sort((a, b) => a.description.localeCompare(b.description)))

  function register(cmd: Command) {
    const idx = subcommands.value.findIndex(c => c.id === cmd.id)
    if (idx === -1) subcommands.value.push(cmd)
    else subcommands.value.splice(idx, 1, cmd)
  }

  function unregister(id: string) {
    const idx = subcommands.value.findIndex(c => c.id === id)
    if (idx !== -1) subcommands.value.splice(idx, 1)
  }

  async function execute(id: string) {
    const cmd = subcommands.value.find(c => c.id === id)
    if (!cmd) {
      console.warn(`[commandCenter] no command with id '${id}'`)
      return
    }
    await cmd.execute()
  }

  function search(query: string): Command[] {
    const q = query.trim().toLowerCase()
    if (!q) return sorted.value
    return sorted.value.filter(c => c.description.toLowerCase().includes(q))
  }

  return { subcommands, sorted, register, unregister, execute, search }
})
