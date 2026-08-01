import { describe, expect, it } from 'vitest'

import { resolveEffectiveTheme } from '../../src/services/preferences-applier'

describe('effective theme selection', () => {
  it('uses the explicitly selected theme when system following is disabled', () => {
    expect(resolveEffectiveTheme('one-dark', 2, false)).toBe('one-dark')
    expect(resolveEffectiveTheme('light', 2, true)).toBe('light')
  })

  it('tracks the operating-system theme in follow mode', () => {
    expect(resolveEffectiveTheme('one-dark', 1, false)).toBe('light')
    expect(resolveEffectiveTheme('light', 1, true)).toBe('dark')
  })
})
