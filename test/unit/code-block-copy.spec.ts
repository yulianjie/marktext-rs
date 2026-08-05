import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/muya/lib/prism/index', () => ({
  loadLanguage: vi.fn(),
}))
vi.mock('../../src/muya/lib/selection', () => ({
  default: {},
}))

class ContentState {}

beforeAll(async () => {
  vi.stubGlobal('window', {
    navigator: {
      platform: 'Win32',
      userAgent: 'win32',
    },
  })
  vi.stubGlobal('document', {})
  const { default: codeBlockCtrl } = await import(
    '../../src/muya/lib/contentState/codeBlockCtrl'
  )
  codeBlockCtrl(ContentState)
})

function createContentState(clipboardWriteText?: (text: string) => Promise<void>) {
  const copy = vi.fn()
  const state = Object.assign(new ContentState(), {
    muya: {
      options: { clipboardWriteText },
      clipboard: { copy },
    },
    getBlock: vi.fn(() => ({
      children: [{
        type: 'code',
        children: [{ text: 'git commit --amend --no-edit && git push -f' }],
      }],
    })),
  }) as ContentState & {
    copyCodeBlock: (event: unknown) => Promise<void>
  }

  const event = {
    target: {
      closest: vi.fn(() => ({ id: 'code-block' })),
    },
  }

  return { state, event, copy }
}

describe('code block copy button', () => {
  it('uses the host clipboard adapter when one is available', async () => {
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined)
    const { state, event, copy } = createContentState(clipboardWriteText)

    await state.copyCodeBlock(event)

    expect(clipboardWriteText).toHaveBeenCalledWith(
      'git commit --amend --no-edit && git push -f',
    )
    expect(copy).not.toHaveBeenCalled()
  })

  it('falls back to Muya copy events if the host adapter fails', async () => {
    const clipboardWriteText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'))
    const { state, event, copy } = createContentState(clipboardWriteText)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await state.copyCodeBlock(event)

    expect(copy).toHaveBeenCalledWith(
      'copyCodeContent',
      'git commit --amend --no-edit && git push -f',
    )
  })
})
