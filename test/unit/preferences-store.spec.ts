import { describe, expect, it } from 'vitest'

import {
  createDefaultPreferencesState,
  sanitizePreferences,
  sanitizeUserData,
} from '../../src/stores/preferences'

describe('preferences store contract', () => {
  it('constructs fresh state from the canonical defaults', () => {
    const state = createDefaultPreferencesState()

    expect(state.fileSortBy).toBe('modified')
    expect(state.startUpAction).toBe('blank')
    expect(state.language).toBe('en')
    expect(state.imageInsertAction).toBe('path')
    expect(state.spellcheckerLanguage).toBe('en_US')
    expect(state.defaultDirectoryToOpen).toBe('')
  })

  it('rejects invalid values and migrates the legacy theme mode', () => {
    expect(sanitizePreferences({ tabSize: 8 })).toEqual({})
    expect(sanitizePreferences({ listIndentation: 'tab' })).toEqual({})
    expect(sanitizePreferences({ futureTypo: true })).toEqual({})
    expect(sanitizePreferences({ autoSwitchTheme: 0 })).toEqual({ autoSwitchTheme: 2 })
  })

  it('downgrades the unsupported legacy S3 uploader safely', () => {
    expect(sanitizeUserData({ currentUploader: 's3' })).toEqual({ currentUploader: 'none' })
    expect(sanitizeUserData({ currentUploader: 'github' })).toEqual({ currentUploader: 'github' })
  })
})
