/**
 * Minimal i18n.
 *
 * Vue's official `vue-i18n` would add ~50 KB and an extra plugin install
 * step. We need exactly four things:
 *   - `t('some.key')` for component templates and scripts
 *   - language switching at runtime (driven by `prefs.language`)
 *   - parameter substitution (`{name}`) for the handful of dynamic strings
 *   - reactive — switching language updates everywhere instantly
 *
 * Implementation: a ref<locale> + nested-key lookup. ~40 LOC, no deps.
 *
 * To add a string: put it in `en.ts`, `zh-CN.ts`, AND `ja.ts` under the same
 * dotted path. Untranslated keys fall back to English, which makes gaps loud
 * at runtime instead of silent.
 */
import { computed, ref } from 'vue'
import en from './en'
import zhCN from './zh-CN'
import ja from './ja'

export type LocaleId = 'en' | 'zh-CN' | 'ja'

const messages: Record<LocaleId, Record<string, unknown>> = {
  en,
  'zh-CN': zhCN,
  ja,
}

const currentLocale = ref<LocaleId>('en')

function lookup(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return typeof cur === 'string' ? cur : undefined
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
}

export function t(key: string, params?: Record<string, string | number>): string {
  const fromCurrent = lookup(messages[currentLocale.value], key)
  if (fromCurrent !== undefined) return interpolate(fromCurrent, params)
  const fromFallback = lookup(messages.en, key)
  if (fromFallback !== undefined) return interpolate(fromFallback, params)
  return key
}

export function setLocale(loc: LocaleId) {
  if (loc in messages) currentLocale.value = loc
}

export function getLocale(): LocaleId { return currentLocale.value }

/** Reactive helper for templates: `<span>{{ t('file.open') }}</span>`. */
export function useI18n() {
  return {
    t,
    locale: computed({
      get: () => currentLocale.value,
      set: setLocale,
    }),
  }
}
