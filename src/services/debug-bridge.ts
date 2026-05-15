/**
 * Forwards renderer-side errors (sync, unhandled rejections, console.error)
 * to the Rust `tracing` subscriber so they show up in the dev terminal.
 *
 * Imported once at the top of `main.ts` — registers global hooks. Calls are
 * fire-and-forget; failures to deliver are swallowed.
 */

import { invoke } from '@tauri-apps/api/core'

interface Payload {
  level: 'error' | 'warn' | 'info' | 'debug'
  message: string
  stack?: string
  source?: string
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function forward(entry: Payload) {
  if (!isTauri) return
  void invoke('cmd_log', { entry }).catch(() => {
    // last-ditch fallback so we don't silently lose the trace
    console.warn('[debug-bridge] forward failed', entry)
  })
}

export function installDebugBridge() {
  if (!isTauri) return

  window.addEventListener('error', ev => {
    forward({
      level: 'error',
      message: `[onerror] ${ev.message}`,
      stack: ev.error?.stack ?? '',
      source: `${ev.filename}:${ev.lineno}:${ev.colno}`,
    })
  })

  window.addEventListener('unhandledrejection', ev => {
    const reason = ev.reason
    const message =
      reason instanceof Error ? reason.message : String(reason ?? 'unknown')
    const stack = reason instanceof Error ? (reason.stack ?? '') : ''
    forward({
      level: 'error',
      message: `[unhandledrejection] ${message}`,
      stack,
    })
  })

  // Mirror console.error to Rust without breaking the normal devtools output.
  const nativeError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    nativeError(...args)
    forward({
      level: 'error',
      message: args
        .map(a =>
          a instanceof Error
            ? a.stack ?? a.message
            : typeof a === 'string'
              ? a
              : safeJson(a),
        )
        .join(' '),
    })
  }

  // Same for console.info — handy for "did mount succeed?" style traces.
  const nativeInfo = console.info.bind(console)
  console.info = (...args: unknown[]) => {
    nativeInfo(...args)
    forward({
      level: 'info',
      message: args
        .map(a =>
          typeof a === 'string' ? a : safeJson(a),
        )
        .join(' '),
    })
  }

  forward({ level: 'info', message: 'debug bridge installed' })
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}
