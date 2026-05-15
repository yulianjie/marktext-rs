/**
 * ESM shim for Snap.svg.
 *
 * Snap.svg ships as a 1990s-style IIFE that attaches `Snap` to the global
 * object. Vite/Rollup can't import-default it directly. We read the bundled
 * minified file as a raw string and eval it in a window context once, then
 * re-export the global it created.
 */

// eslint-disable-next-line import/no-unresolved
import snapSource from './snap.svg-min.js?raw'

const globalRef =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
      ? window
      : typeof self !== 'undefined'
        ? self
        : {}

if (!globalRef.__SNAP_SVG_LOADED__) {
  // eslint-disable-next-line no-new-func
  new Function('window', 'self', 'globalThis', snapSource).call(
    globalRef,
    globalRef,
    globalRef,
    globalRef,
  )
  globalRef.__SNAP_SVG_LOADED__ = true
}

const Snap = globalRef.Snap

export default Snap
export { Snap }
