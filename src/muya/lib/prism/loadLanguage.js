import components from 'prismjs/components.js'
import { getDefer } from '../utils'

// Vite needs a statically-analysable list of prism language modules so it can
// resolve `import('prismjs/components/prism-<lang>')` at runtime. Use
// `import.meta.glob` to materialise the registry at build time. Negative
// pattern excludes the `.min.js` variants which don't have ES exports.
//
// Relative path (not root-relative `/node_modules/...`) because Vite's
// Windows path resolution mangles the latter into an unresolvable mix of
// `..` and `c:/`.
const LANG_LOADERS = import.meta.glob([
  '../../../../node_modules/prismjs/components/prism-*.js',
  '!../../../../node_modules/prismjs/components/prism-*.min.js',
])

function langKey(lang) {
  return `../../../../node_modules/prismjs/components/prism-${lang}.js`
}

/**
 * The set of all languages which have been loaded using the below function.
 *
 * @type {Set<string>}
 */
export const loadedLanguages = new Set(['markup', 'css', 'clike', 'javascript'])

const { languages } = components

// Look for the origin language by alias
export const transformAliasToOrigin = langs => {
  const result = []
  for (const lang of langs) {
    if (languages[lang]) {
      result.push(lang)
    } else {
      const language = Object.keys(languages).find(name => {
        const l = languages[name]
        if (l.alias) {
          return l.alias === lang || (Array.isArray(l.alias) && l.alias.includes(lang))
        }
        return false
      })
      if (language) result.push(language)
      else result.push(lang)
    }
  }
  return result
}

// Walk the prismjs `components.json` dependency graph and return a topologically
// ordered list of languages to load (deps first). Replaces the node-only
// `prismjs/dependencies` package which uses `require()` and breaks in the
// browser.
function resolveDependencyOrder(targetLangs, alreadyLoaded) {
  const visited = new Set()
  const ordered = []
  const visit = lang => {
    if (visited.has(lang) || alreadyLoaded.has(lang)) return
    visited.add(lang)
    const meta = languages[lang]
    if (!meta) return
    const requires = []
    if (meta.require) {
      const arr = Array.isArray(meta.require) ? meta.require : [meta.require]
      requires.push(...arr)
    }
    if (meta.modify) {
      const arr = Array.isArray(meta.modify) ? meta.modify : [meta.modify]
      requires.push(...arr)
    }
    for (const dep of requires) visit(dep)
    ordered.push(lang)
  }
  for (const lang of targetLangs) visit(lang)
  return ordered
}

function initLoadLanguage(Prism) {
  return async function loadLanguages(langs) {
    if (!langs) {
      langs = Object.keys(languages).filter(lang => lang !== 'meta')
    }
    if (langs && !langs.length) {
      return Promise.reject(
        new Error('The first parameter should be a list of load languages or single language.'),
      )
    }
    if (!Array.isArray(langs)) {
      langs = [langs]
    }

    const loaded = new Set([...loadedLanguages, ...Object.keys(Prism.languages)])
    const ordered = resolveDependencyOrder(langs, loaded)

    const promises = []
    for (const lang of ordered) {
      const defer = getDefer()
      promises.push(defer.promise)
      if (!(lang in languages)) {
        defer.resolve({ lang, status: 'noexist' })
        continue
      }
      if (loadedLanguages.has(lang)) {
        defer.resolve({ lang, status: 'cached' })
        continue
      }
      const loader = LANG_LOADERS[langKey(lang)]
      if (!loader) {
        defer.resolve({ lang, status: 'noexist' })
        continue
      }
      try {
        // Prismjs language definitions register themselves on global `Prism`.
        delete Prism.languages[lang]
        await loader()
        loadedLanguages.add(lang)
        defer.resolve({ lang, status: 'loaded' })
      } catch (err) {
        defer.resolve({ lang, status: 'error', error: err })
      }
    }
    return Promise.all(promises)
  }
}

export default initLoadLanguage
