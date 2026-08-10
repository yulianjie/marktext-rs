/**
 * Spellchecker — bridges Muya's UI to the Rust Hunspell backend.
 *
 * Muya itself doesn't know about IPC; it asks for a synchronous-ish API
 * (`enabled`, `language`, `setEnabled`, `setLanguage`).
 * We satisfy that surface and additionally expose `check()` / `suggest()` /
 * `addWord()` / `removeWord()` for the rest of the app (context menu,
 * preferences UI).
 *
 * Words are batched into a single call per check — the renderer requests
 * misspellings per paragraph and the backend returns only the misspelled
 * subset.
 */
import {
  spellcheckAddWord,
  spellcheckAvailableDictionaries,
  spellcheckRemoveWord,
  spellcheckSuggest,
  spellcheckWords,
} from './tauri-invoke'
export interface SpellcheckerLike {
  enabled: boolean
  language: string
  setEnabled(value: boolean): Promise<void>
  setLanguage(lang: string): Promise<void>
  /** Returns the subset of `words` that the dictionary doesn't recognise. */
  check(words: string[]): Promise<string[]>
  suggest(word: string): Promise<string[]>
  addWord(word: string): Promise<void>
  removeWord(word: string): Promise<void>
  availableLanguages(): Promise<string[]>
}

export class Spellchecker implements SpellcheckerLike {
  enabled = false
  language = 'en_US'

  async setEnabled(value: boolean): Promise<void> {
    this.enabled = value
  }

  async setLanguage(lang: string): Promise<void> {
    this.language = lang
  }

  async check(words: string[]): Promise<string[]> {
    if (!this.enabled || words.length === 0) return []
    try { return await spellcheckWords(words) }
    catch { return [] }
  }

  async suggest(word: string): Promise<string[]> {
    if (!this.enabled) return []
    try { return await spellcheckSuggest(word) }
    catch { return [] }
  }

  async addWord(word: string): Promise<void> {
    try { await spellcheckAddWord(word) } catch { /* swallow */ }
  }

  async removeWord(word: string): Promise<void> {
    try { await spellcheckRemoveWord(word) } catch { /* swallow */ }
  }

  async availableLanguages(): Promise<string[]> {
    try { return await spellcheckAvailableDictionaries() }
    catch { return [] }
  }
}

export const spellchecker: SpellcheckerLike = new Spellchecker()
