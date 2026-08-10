import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  emptySearchRevealGuard,
  enqueueSearchReveal,
  searchCoordinatesToEditorRange,
  settleSearchReveal,
  type SearchRevealRequest,
} from '../../src/services/search-reveal'

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

function request(
  requestId: number,
  tabId: string,
  mode: SearchRevealRequest['mode'] = 'source',
): SearchRevealRequest {
  return {
    requestId,
    tabId,
    path: `${tabId}.md`,
    mode,
    line: 1,
    column: 1,
    length: 1,
  }
}

describe('folder-search coordinate conversion', () => {
  it('converts Unicode-scalar columns and lengths to UTF-16 cursor offsets', () => {
    const markdown = 'zero\n😀x needle\nlast'
    expect(searchCoordinatesToEditorRange(markdown, {
      line: 2,
      column: 4,
      length: 6,
    })).toEqual({
      line: 1,
      startCh: 4,
      endCh: 10,
      from: 9,
      to: 15,
    })

    expect(searchCoordinatesToEditorRange(markdown, {
      line: 2,
      column: 1,
      length: 1,
    })).toEqual({
      line: 1,
      startCh: 0,
      endCh: 2,
      from: 5,
      to: 7,
    })
  })

  it('clamps invalid lines, columns, and lengths to valid document ranges', () => {
    expect(searchCoordinatesToEditorRange('one\nlast', {
      line: 99,
      column: 99,
      length: 99,
    })).toEqual({ line: 1, startCh: 4, endCh: 4, from: 8, to: 8 })

    expect(searchCoordinatesToEditorRange('one\nlast', {
      line: -5,
      column: 0,
      length: -3,
    })).toEqual({ line: 0, startCh: 0, endCh: 0, from: 0, to: 0 })
  })

  it('keeps absolute offsets correct when CRLF and non-BMP text are present', () => {
    expect(searchCoordinatesToEditorRange('a\r\n😀b', {
      line: 2,
      column: 2,
      length: 1,
    })).toEqual({ line: 1, startCh: 2, endCh: 3, from: 5, to: 6 })
  })
})

describe('folder-search reveal request guard', () => {
  it('keeps the newest rapid request and waits for that tab to bind', () => {
    let state = enqueueSearchReveal(emptySearchRevealGuard(), request(1, 'a'))
    state = enqueueSearchReveal(state, request(2, 'b'))
    expect(state.pending?.tabId).toBe('b')

    const waiting = settleSearchReveal(state, {
      currentTabId: 'b',
      boundTabId: 'a',
      consumerMode: 'source',
      activeMode: 'source',
    })
    expect(waiting.request).toBeNull()
    expect(waiting.state.pending?.requestId).toBe(2)

    const ready = settleSearchReveal(waiting.state, {
      currentTabId: 'b',
      boundTabId: 'b',
      consumerMode: 'source',
      activeMode: 'source',
    })
    expect(ready.request?.requestId).toBe(2)
    expect(ready.state.pending).toBeNull()
  })

  it('discards a delayed request after the user switches to another tab', () => {
    const state = enqueueSearchReveal(emptySearchRevealGuard(), request(1, 'a'))
    const result = settleSearchReveal(state, {
      currentTabId: 'b',
      boundTabId: 'b',
      consumerMode: 'source',
      activeMode: 'source',
    })
    expect(result.request).toBeNull()
    expect(result.state.pending).toBeNull()
  })

  it('allows only the active requested editor mode to process a hit', () => {
    const sourceState = enqueueSearchReveal(emptySearchRevealGuard(), request(1, 'a', 'source'))
    const source = settleSearchReveal(sourceState, {
      currentTabId: 'a',
      boundTabId: 'a',
      consumerMode: 'source',
      activeMode: 'source',
    })
    const muya = settleSearchReveal(sourceState, {
      currentTabId: 'a',
      boundTabId: 'a',
      consumerMode: 'wysiwyg',
      activeMode: 'source',
    })
    expect(source.request?.requestId).toBe(1)
    expect(muya.request).toBeNull()
  })

  it('ignores requests that have already been handled', () => {
    const pending = enqueueSearchReveal(emptySearchRevealGuard(), request(1, 'a'))
    const handled = settleSearchReveal(pending, {
      currentTabId: 'a',
      boundTabId: 'a',
      consumerMode: 'source',
      activeMode: 'source',
    }).state
    expect(enqueueSearchReveal(handled, request(1, 'a'))).toBe(handled)
  })
})

describe('folder-search reveal component contract', () => {
  const searchPane = readSource('../../src/components/sideBar/SearchPane.vue')
  const sourcePane = readSource('../../src/components/editorWithTabs/SourceCodePane.vue')
  const muyaEditor = readSource('../../src/components/editorWithTabs/MuyaEditor.vue')

  it('opens only successful results and exposes location plus keyboard activation', () => {
    const openHit = searchPane.slice(
      searchPane.indexOf('async function openHit'),
      searchPane.indexOf('// Debounced auto-search'),
    )
    const catchOffset = openHit.indexOf('} catch (err)')
    expect(openHit.indexOf("bus.emit('reveal-search-hit'")).toBeGreaterThan(0)
    expect(catchOffset).toBeGreaterThan(openHit.indexOf("bus.emit('reveal-search-hit'"))
    expect(openHit.slice(catchOffset)).not.toContain("bus.emit('reveal-search-hit'")
    expect(searchPane).toContain('@keydown.enter.prevent')
    expect(searchPane).toContain('@keydown.space.prevent')
    expect(searchPane).toContain(':aria-current=')
    expect(searchPane).toContain(':aria-selected=')
    expect(searchPane).toContain('{{ hit.line }}:{{ hit.column }}')
  })

  it('selects, centers, and focuses in exactly one active editor mode', () => {
    expect(sourcePane).toContain("consumerMode: 'source'")
    expect(sourcePane).toContain('selection: { anchor: range.from, head: range.to }')
    expect(sourcePane).toContain("EditorView.scrollIntoView(range.from, { y: 'center' })")
    expect(sourcePane).toContain('view.focus()')

    expect(muyaEditor).toContain("consumerMode: 'wysiwyg'")
    expect(muyaEditor).toContain('muya.setCursor({')
    expect(muyaEditor).toContain('anchor: { line: range.line, ch: range.startCh }')
    expect(muyaEditor).toContain('focus: { line: range.line, ch: range.endCh }')
    expect(muyaEditor).toContain('muya.focus()')
    expect(muyaEditor).toContain('window.requestAnimationFrame(centerMuyaSelection)')
  })
})
