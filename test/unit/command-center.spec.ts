import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

import { setLocale, t } from '../../src/i18n'
import {
  nextEnabledCommandIndex,
  normalizeCommandIndex,
  safeCommandIndex,
  useCommandCenterStore,
} from '../../src/stores/commandCenter'

describe('command center', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setLocale('en')
  })

  it('uses fuzzy scoring across the description, stable id, and optional keywords', () => {
    const store = useCommandCenterStore()
    const noop = () => undefined
    store.register({
      id: 'file.open',
      category: 'File',
      categoryOrder: 0,
      description: 'Open File',
      keywords: ['documents folder'],
      execute: noop,
    })
    store.register({
      id: 'view.toggleSourceCode',
      category: 'View',
      categoryOrder: 1,
      description: 'Toggle Source Code Mode',
      keywords: ['source markdown'],
      execute: noop,
    })

    expect(store.search('opn fle').map(command => command.id)).toEqual(['file.open'])
    expect(store.search('file.open')[0]?.id).toBe('file.open')
    expect(store.search('documents')[0]?.id).toBe('file.open')
    expect(store.search('srcmd')[0]?.id).toBe('view.toggleSourceCode')
  })

  it('sorts an empty query by category and localized title with stable id ties', () => {
    const store = useCommandCenterStore()
    const noop = () => undefined
    store.register({ id: 'view.z', category: 'View', categoryOrder: 1, description: 'Alpha', execute: noop })
    store.register({ id: 'file.z', category: 'File', categoryOrder: 0, description: 'Zulu', execute: noop })
    store.register({ id: 'file.b', category: 'File', categoryOrder: 0, description: 'Alpha', execute: noop })
    store.register({ id: 'file.a', category: 'File', categoryOrder: 0, description: 'Alpha', execute: noop })

    expect(store.search('').map(command => command.id)).toEqual([
      'file.a',
      'file.b',
      'file.z',
      'view.z',
    ])
  })

  it('resolves labels reactively after a locale switch without re-registering', () => {
    const store = useCommandCenterStore()
    store.register({
      id: 'file.new',
      category: () => t('command.categories.file'),
      description: () => t('command.actions.file.new'),
      execute: () => undefined,
    })

    expect(store.search('')[0]).toMatchObject({ category: 'File', description: 'New Tab' })
    setLocale('zh-CN')
    expect(store.search('')[0]).toMatchObject({ category: '文件', description: '新建标签页' })
    setLocale('ja')
    expect(store.search('')[0]).toMatchObject({ category: 'ファイル', description: '新しいタブ' })
  })

  it('keeps unavailable commands visible and refuses to execute them', async () => {
    const store = useCommandCenterStore()
    const execute = vi.fn()
    const available = ref(false)
    store.register({
      id: 'format.bold',
      description: 'Bold',
      execute,
      when: () => available.value,
    })

    expect(store.search('')[0]?.disabled).toBe(true)
    await expect(store.execute('format.bold')).resolves.toBe(false)
    expect(execute).not.toHaveBeenCalled()

    available.value = true
    expect(store.search('')[0]?.disabled).toBe(false)
    await expect(store.execute('format.bold')).resolves.toBe(true)
    expect(execute).toHaveBeenCalledOnce()
  })

  it('keeps keyboard selection in range and skips disabled results', () => {
    const commands = [
      { disabled: false },
      { disabled: true },
      { disabled: false },
    ]

    expect(normalizeCommandIndex(0, -1)).toBe(0)
    expect(normalizeCommandIndex(3, -1)).toBe(0)
    expect(normalizeCommandIndex(3, 99)).toBe(2)
    expect(nextEnabledCommandIndex(commands, 0, 1)).toBe(2)
    expect(nextEnabledCommandIndex(commands, 2, 1)).toBe(2)
    expect(nextEnabledCommandIndex(commands, 2, -1)).toBe(0)
    expect(safeCommandIndex(commands, 1)).toBe(0)
    expect(safeCommandIndex([{ disabled: true }], 4)).toBe(0)
  })
})
