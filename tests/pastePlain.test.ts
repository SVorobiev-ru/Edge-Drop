import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pasteOptionsFor } from '../src/lib/pasteOptions'
import { useStore } from '../src/store/appStore'
import type { ClipboardItemDto } from '../shared/types'

const text: Pick<ClipboardItemDto, 'data'> = { data: { kind: 'text', text: 'hi', isUrl: false } }
const image: Pick<ClipboardItemDto, 'data'> = {
  data: { kind: 'image', imageId: 'i', width: 1, height: 1, bytes: 1, preview: 'data:,' }
}

describe('plain paste option', () => {
  it('uses the setting XOR the Option key on macOS', () => {
    expect(pasteOptionsFor(text, { pastePlainText: false }, false, 'darwin')).toEqual({ plain: false })
    expect(pasteOptionsFor(text, { pastePlainText: false }, true, 'darwin')).toEqual({ plain: true })
    expect(pasteOptionsFor(text, { pastePlainText: true }, false, 'darwin')).toEqual({ plain: true })
    expect(pasteOptionsFor(text, { pastePlainText: true }, true, 'darwin')).toEqual({ plain: false })
  })

  it('ignores the modifier on Windows', () => {
    expect(pasteOptionsFor(text, { pastePlainText: false }, true, 'win32')).toEqual({ plain: false })
    expect(pasteOptionsFor(text, { pastePlainText: true }, true, 'win32')).toEqual({ plain: true })
  })

  it('sends no option for non-text items', () => {
    expect(pasteOptionsFor(image, { pastePlainText: true }, true, 'darwin')).toBeUndefined()
  })
})

describe('store paste forwards the option', () => {
  const g = globalThis as { window?: unknown }
  const originalWindow = g.window

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    g.window = originalWindow
  })

  it('passes plain to the bridge when given', async () => {
    const pasteItem = vi.fn().mockResolvedValue(true)
    g.window = { edge: { pasteItem } }
    await useStore.getState().paste('a', { plain: true })
    expect(pasteItem).toHaveBeenCalledWith('a', { plain: true })
  })

  it('keeps the one-argument call without an option', async () => {
    const pasteItem = vi.fn().mockResolvedValue(true)
    g.window = { edge: { pasteItem } }
    await useStore.getState().paste('b')
    expect(pasteItem).toHaveBeenCalledWith('b')
  })
})
