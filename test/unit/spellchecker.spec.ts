import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  spellcheckWords: vi.fn(),
  spellcheckSuggest: vi.fn(),
  spellcheckAddWord: vi.fn(),
  spellcheckRemoveWord: vi.fn(),
  spellcheckAvailableDictionaries: vi.fn(),
}))
const busEmit = vi.hoisted(() => vi.fn())

vi.mock('../../src/services/tauri-invoke', () => ipc)
vi.mock('../../src/bus', () => ({ bus: { emit: busEmit } }))

import { Spellchecker } from '../../src/services/spellchecker'

describe('spellchecker one-way state bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipc.spellcheckWords.mockResolvedValue([])
    ipc.spellcheckSuggest.mockResolvedValue([])
    ipc.spellcheckAddWord.mockResolvedValue(undefined)
    ipc.spellcheckRemoveWord.mockResolvedValue(undefined)
    ipc.spellcheckAvailableDictionaries.mockResolvedValue([])
  })

  it('updates language locally without emitting a command back into Muya', async () => {
    const spellchecker = new Spellchecker()
    await spellchecker.setLanguage('en_GB')

    expect(spellchecker.language).toBe('en_GB')
    expect(busEmit).not.toHaveBeenCalled()
  })

  it('checks and suggests once per explicit request when enabled', async () => {
    ipc.spellcheckWords.mockResolvedValue(['teh'])
    ipc.spellcheckSuggest.mockResolvedValue(['the'])
    const spellchecker = new Spellchecker()
    await spellchecker.setEnabled(true)

    await expect(spellchecker.check(['teh'])).resolves.toEqual(['teh'])
    await expect(spellchecker.suggest('teh')).resolves.toEqual(['the'])
    expect(ipc.spellcheckWords).toHaveBeenCalledTimes(1)
    expect(ipc.spellcheckSuggest).toHaveBeenCalledTimes(1)
  })

  it('routes dictionary mutations to the typed backend wrappers', async () => {
    const spellchecker = new Spellchecker()
    await spellchecker.addWord('Codex')
    await spellchecker.removeWord('Codex')

    expect(ipc.spellcheckAddWord).toHaveBeenCalledWith('Codex')
    expect(ipc.spellcheckRemoveWord).toHaveBeenCalledWith('Codex')
  })
})
