/**
 * Browser-side UUID — Web Crypto's `crypto.randomUUID` is available in every
 * Chromium/WebKit that Tauri ships. Tiny wrapper so we can swap fallback
 * generation in one place if we ever need to.
 */
export function v4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Last-resort fallback. Should never run in production.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
