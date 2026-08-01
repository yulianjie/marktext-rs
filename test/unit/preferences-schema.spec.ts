import { describe, expect, it } from 'vitest'

import schema from '../../src/common/preferences-schema.json'
import legacyDefaults from '../../static/preference.json'

type PreferenceRule = {
  type?: 'boolean' | 'number' | 'string' | 'array' | 'object'
  default?: unknown
  enum?: unknown[]
  minimum?: number
  maximum?: number
  pattern?: string
}

const rules = schema as Record<string, PreferenceRule>

describe('preferences schema', () => {
  it('keeps the canonical defaults used on a fresh install', () => {
    expect(rules.fileSortBy.default).toBe('modified')
    expect(rules.startUpAction.default).toBe('blank')
    expect(rules.language.default).toBe('en')
    expect(rules.imageInsertAction.default).toBe('path')
    expect(rules.spellcheckerLanguage.default).toBe('en_US')
  })

  it('keeps every declared default inside its own constraints', () => {
    for (const [key, rule] of Object.entries(rules)) {
      if (!Object.hasOwn(rule, 'default')) continue
      const value = rule.default

      if (rule.type === 'array') expect(Array.isArray(value), key).toBe(true)
      else if (rule.type) expect(typeof value, key).toBe(rule.type)

      if (rule.enum) expect(rule.enum, key).toContain(value)
      if (typeof value === 'number' && rule.minimum !== undefined) {
        expect(value, key).toBeGreaterThanOrEqual(rule.minimum)
      }
      if (typeof value === 'number' && rule.maximum !== undefined) {
        expect(value, key).toBeLessThanOrEqual(rule.maximum)
      }
      if (typeof value === 'string' && rule.pattern) {
        expect(new RegExp(rule.pattern).test(value), key).toBe(true)
      }
    }
  })

  it('keeps the legacy default snapshot aligned with the canonical schema', () => {
    for (const [key, rule] of Object.entries(rules)) {
      if (!Object.hasOwn(rule, 'default')) continue
      expect((legacyDefaults as Record<string, unknown>)[key], key).toEqual(rule.default)
    }
  })

  it('matches the limits supported by the Muya indentation engine', () => {
    expect(rules.tabSize.minimum).toBe(1)
    expect(rules.tabSize.maximum).toBe(4)
    expect(rules.listIndentation.enum).toEqual(['dfm', 1, 2, 3, 4])
  })

  it('accepts only locales shipped by the renderer', () => {
    expect(rules.language.enum).toEqual(['en', 'zh-CN', 'ja'])
  })
})
