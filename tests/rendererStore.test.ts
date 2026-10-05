import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore, selectReduceMotion } from '../src/store/appStore'
import { DEFAULT_SETTINGS, type ClipboardItemDto } from '../shared/types'
import { EMPTY_SELECTION, SELECTION_LIMIT } from '../shared/selection'
import { setNavOrder } from '../src/lib/keyboardNav'

const g = globalThis as { window?: unknown }
const originalWindow = g.window

function installEdge(api: Record<string, unknown>): void {
  g.window = { edge: api }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  useStore.setState({
    hydrated: false,
    items: [],
    settings: { ...DEFAULT_SETTINGS },
    isInternalCopying: false,
    systemReduceMotion: false,
    toasts: [],
    keyboardMode: false,
    selection: EMPTY_SELECTION,
    selectedMap: {},
    selectionTexts: {},
    queueIds: [],
    queueIndex: {}
  })
  setNavOrder([])
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  g.window = originalWindow
})

describe('paste releases the internal-copy guard', () => {
  it('clears the flag after a successful paste', async () => {
    const pasteItem = vi.fn().mockResolvedValue(undefined)
    installEdge({ pasteItem })
    await useStore.getState().paste('a')
    expect(pasteItem).toHaveBeenCalledWith('a')
    expect(useStore.getState().isInternalCopying).toBe(true)
    await vi.advanceTimersByTimeAsync(600)
    expect(useStore.getState().isInternalCopying).toBe(false)
  })

  it('clears the flag when the IPC call rejects', async () => {
    installEdge({ pasteItem: vi.fn().mockRejectedValue(new Error('ipc down')) })
    await expect(useStore.getState().paste('a')).rejects.toThrow('ipc down')
    expect(useStore.getState().isInternalCopying).toBe(true)
    await vi.advanceTimersByTimeAsync(600)
    expect(useStore.getState().isInternalCopying).toBe(false)
  })
})

describe('hydrate retries', () => {
  const loaded = {
    items: [{ id: 'i1', data: { kind: 'text', text: 'hi', isUrl: false }, capturedAt: 1, hitCount: 1, pinned: false }],
    settings: { ...DEFAULT_SETTINGS, stickPosition: 'right' },
    version: '9.9.9'
  }

  it('hydrates on the first successful load', async () => {
    const loadState = vi.fn().mockResolvedValue(loaded)
    installEdge({ loadState })
    await useStore.getState().hydrate()
    expect(loadState).toHaveBeenCalledTimes(1)
    expect(useStore.getState().hydrated).toBe(true)
    expect(useStore.getState().currentVersion).toBe('9.9.9')
    expect(useStore.getState().settings.stickPosition).toBe('right')
  })

  it('retries with backoff after failures and then hydrates', async () => {
    const loadState = vi
      .fn()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValue(loaded)
    installEdge({ loadState })
    const done = useStore.getState().hydrate()
    await vi.advanceTimersByTimeAsync(0)
    expect(loadState).toHaveBeenCalledTimes(1)
    expect(useStore.getState().hydrated).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(loadState).toHaveBeenCalledTimes(2)
    expect(useStore.getState().hydrated).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    await done
    expect(loadState).toHaveBeenCalledTimes(3)
    expect(useStore.getState().hydrated).toBe(true)
    expect(useStore.getState().items).toHaveLength(1)
  })

  it('treats an empty reply as a failure', async () => {
    const loadState = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(loaded)
    installEdge({ loadState })
    const done = useStore.getState().hydrate()
    await vi.advanceTimersByTimeAsync(200)
    await done
    expect(loadState).toHaveBeenCalledTimes(2)
    expect(useStore.getState().hydrated).toBe(true)
  })

  it('stops after the last attempt and still lets the panel render', async () => {
    const loadState = vi.fn().mockRejectedValue(new Error('gone'))
    installEdge({ loadState })
    const done = useStore.getState().hydrate()
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(done).resolves.toBeUndefined()
    expect(loadState).toHaveBeenCalledTimes(5)
    expect(useStore.getState().hydrated).toBe(true)
    expect(useStore.getState().items).toEqual([])
  })

  it('reports the failure and keeps loading in the background every 10 s', async () => {
    const loadState = vi
      .fn()
      .mockRejectedValueOnce(new Error('gone'))
      .mockRejectedValueOnce(new Error('gone'))
      .mockRejectedValueOnce(new Error('gone'))
      .mockRejectedValueOnce(new Error('gone'))
      .mockRejectedValueOnce(new Error('gone'))
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValue(loaded)
    installEdge({ loadState })
    const done = useStore.getState().hydrate()
    await vi.advanceTimersByTimeAsync(4400)
    await done
    expect(useStore.getState().toasts.map((t) => t.message)).toEqual(['toast.loadFailed'])
    expect(useStore.getState().items).toEqual([])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(loadState).toHaveBeenCalledTimes(6)
    expect(useStore.getState().items).toEqual([])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(loadState).toHaveBeenCalledTimes(7)
    expect(useStore.getState().items).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(loadState).toHaveBeenCalledTimes(7)
  })
})

const textItem = (id: string, extra: Record<string, unknown> = {}): ClipboardItemDto =>
  ({ id, data: { kind: 'text', text: id, isUrl: false, ...extra }, capturedAt: 1, hitCount: 1, pinned: false }) as ClipboardItemDto
const imageItem = (id: string): ClipboardItemDto =>
  ({ id, data: { kind: 'image', imageId: id, width: 1, height: 1, bytes: 1 }, capturedAt: 1, hitCount: 1, pinned: false }) as ClipboardItemDto

describe('keyboard mode', () => {
  it('focuses the window only when it enters keyboard mode', () => {
    const focusWindow = vi.fn().mockResolvedValue(undefined)
    installEdge({ focusWindow })
    useStore.getState().enterKeyboardMode()
    useStore.getState().enterKeyboardMode()
    expect(focusWindow).toHaveBeenCalledTimes(1)
    expect(useStore.getState().keyboardMode).toBe(true)
  })
})

describe('keyboard hand-off before a paste', () => {
  it('on darwin a pointer paste leaves keyboard mode and gives the keyboard back before pasting', async () => {
    const calls: string[] = []
    const focusWindow = vi.fn(async (focusable: boolean) => { calls.push(`focus(${focusable})`) })
    const pasteItem = vi.fn(async () => { calls.push('paste') })
    installEdge({ platform: 'darwin', focusWindow, pasteItem })
    useStore.setState({ keyboardMode: true, open: true })
    await useStore.getState().paste('a')
    expect(calls).toEqual(['focus(false)', 'paste'])
    expect(useStore.getState().keyboardMode).toBe(false)
    expect(useStore.getState().open).toBe(true)
  })

  it('on darwin hands off before an emoji paste too', async () => {
    const calls: string[] = []
    installEdge({
      platform: 'darwin',
      focusWindow: vi.fn(async () => { calls.push('focus(false)') }),
      pasteEmoji: vi.fn(async () => { calls.push('emoji') })
    })
    useStore.setState({ keyboardMode: true })
    await useStore.getState().pasteEmoji('😀')
    expect(calls).toEqual(['focus(false)', 'emoji'])
  })

  it('on darwin does not touch focus when the panel never had the keyboard', async () => {
    const focusWindow = vi.fn()
    const pasteItem = vi.fn().mockResolvedValue(true)
    installEdge({ platform: 'darwin', focusWindow, pasteItem })
    await useStore.getState().paste('a')
    expect(focusWindow).not.toHaveBeenCalled()
    expect(pasteItem).toHaveBeenCalledWith('a')
  })

  it('on darwin a keyboard paste keeps keyboard mode and takes the keyboard back once the keys went out', async () => {
    const calls: string[] = []
    const focusWindow = vi.fn(async (focusable: boolean) => { calls.push(`focus(${focusable})`) })
    const pasteItem = vi.fn(async () => { calls.push('paste') })
    installEdge({ platform: 'darwin', focusWindow, pasteItem })
    useStore.setState({ keyboardMode: true, open: true, activeItemId: 'a' })
    await useStore.getState().paste('a', undefined, true)
    expect(calls).toEqual(['paste'])
    expect(useStore.getState().keyboardMode).toBe(true)
    expect(useStore.getState().activeItemId).toBe('a')
    await vi.advanceTimersByTimeAsync(250)
    expect(calls).toEqual(['paste', 'focus(true)'])
  })

  it('on darwin a keyboard selection paste keeps keyboard mode too', async () => {
    const focusWindow = vi.fn().mockResolvedValue(undefined)
    installEdge({ platform: 'darwin', focusWindow, pasteMulti: vi.fn().mockResolvedValue(true) })
    useStore.setState({ keyboardMode: true, open: true, items: [{ id: 'a', data: { kind: 'text', text: 'a', isUrl: false }, capturedAt: 1, hitCount: 1, pinned: false }] as ClipboardItemDto[] })
    setNavOrder(['a'])
    useStore.getState().toggleSelected('a')
    await useStore.getState().pasteSelection(false, true)
    expect(useStore.getState().keyboardMode).toBe(true)
    await vi.advanceTimersByTimeAsync(250)
    expect(focusWindow).toHaveBeenCalledWith(true)
    expect(focusWindow).not.toHaveBeenCalledWith(false)
  })

  it('on darwin does not take the keyboard back after the panel closed', async () => {
    const focusWindow = vi.fn().mockResolvedValue(undefined)
    installEdge({ platform: 'darwin', focusWindow, pasteItem: vi.fn().mockResolvedValue(true) })
    useStore.setState({ keyboardMode: true, open: true })
    await useStore.getState().paste('a', undefined, true)
    useStore.setState({ open: false })
    await vi.advanceTimersByTimeAsync(250)
    expect(focusWindow).not.toHaveBeenCalled()
  })

  it('on win32 a keyboard paste does not touch focus', async () => {
    const focusWindow = vi.fn()
    installEdge({ platform: 'win32', focusWindow, pasteItem: vi.fn().mockResolvedValue(true) })
    useStore.setState({ keyboardMode: true, open: true })
    await useStore.getState().paste('a', undefined, true)
    await vi.advanceTimersByTimeAsync(250)
    expect(focusWindow).not.toHaveBeenCalled()
  })

  it('on win32 leaves keyboard state alone', async () => {
    const focusWindow = vi.fn()
    installEdge({ platform: 'win32', focusWindow, pasteItem: vi.fn().mockResolvedValue(true) })
    useStore.setState({ keyboardMode: true })
    await useStore.getState().paste('a')
    expect(focusWindow).not.toHaveBeenCalled()
    expect(useStore.getState().keyboardMode).toBe(true)
  })
})

describe('selection in the store', () => {
  it('keeps per-card lookup maps for the selection and the queue', () => {
    installEdge({})
    useStore.getState().toggleSelected('a')
    useStore.getState().toggleSelected('b')
    expect(useStore.getState().selectedMap).toEqual({ a: true, b: true })
    useStore.getState().clearSelection()
    expect(useStore.getState().selectedMap).toEqual({})
    useStore.getState().setQueueIds(['x', 'y'])
    expect(useStore.getState().queueIndex).toEqual({ x: 0, y: 1 })
  })

  it('selects all only up to the limit and says so', () => {
    installEdge({})
    const order = Array.from({ length: SELECTION_LIMIT + 5 }, (_, i) => `i${i}`)
    useStore.getState().selectAllVisible(order)
    expect(useStore.getState().selection.ids).toHaveLength(SELECTION_LIMIT)
    expect(useStore.getState().toasts.map((t) => t.message)).toEqual(['toast.selectionTooLarge'])
  })

  it('drops hidden items and acts only on visible ones', () => {
    installEdge({})
    useStore.setState({ items: [textItem('a'), textItem('b'), textItem('c')] })
    useStore.getState().selectAllVisible(['a', 'b', 'c'])
    setNavOrder(['a', 'c'])
    expect(useStore.getState().selectedIdsInOrder()).toEqual(['a', 'c'])
    useStore.getState().keepSelectionWithin(['a', 'c'])
    expect(useStore.getState().selection.ids).toEqual(['a', 'c'])
    expect(useStore.getState().selectedMap).toEqual({ a: true, c: true })
  })

  it('rolls back a bulk pin that failed', async () => {
    installEdge({ pinMulti: vi.fn().mockRejectedValue(new Error('ipc down')) })
    useStore.setState({ items: [textItem('a'), textItem('b')] })
    setNavOrder(['a', 'b'])
    useStore.getState().selectAllVisible(['a', 'b'])
    await useStore.getState().pinSelection(true)
    expect(useStore.getState().items.map((it) => it.pinned)).toEqual([false, false])
  })

  it('does not prestage drags and loads full texts lazily for a text-only selection', async () => {
    const prestageDrag = vi.fn()
    const getFullText = vi.fn((id: string) => Promise.resolve(`full ${id}`))
    installEdge({ platform: 'darwin', prestageDrag, getFullText })
    useStore.setState({ items: [textItem('a', { hasFullPayload: true }), textItem('b', { hasFullPayload: true }), imageItem('c')] })
    useStore.getState().toggleSelected('a')
    useStore.getState().toggleSelected('b')
    expect(getFullText).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(getFullText).toHaveBeenCalledTimes(2)
    expect(useStore.getState().selectionTexts).toEqual({ a: 'full a', b: 'full b' })
    useStore.getState().toggleSelected('c')
    await vi.advanceTimersByTimeAsync(300)
    expect(getFullText).toHaveBeenCalledTimes(2)
    expect(prestageDrag).not.toHaveBeenCalled()
  })
})

describe('effective reduce motion', () => {
  it('combines the setting with the system preference', () => {
    const base = useStore.getState()
    expect(selectReduceMotion(base)).toBe(false)
    expect(selectReduceMotion({ ...base, systemReduceMotion: true })).toBe(true)
    expect(selectReduceMotion({ ...base, settings: { ...base.settings, reduceMotion: true } })).toBe(true)
  })

  it('tracks the system preference in the store', () => {
    useStore.getState().setSystemReduceMotion(true)
    expect(selectReduceMotion(useStore.getState())).toBe(true)
    useStore.getState().setSystemReduceMotion(false)
    expect(selectReduceMotion(useStore.getState())).toBe(false)
  })
})

describe('launch at login toggle', () => {
  it('shows the new value at once and saves it through main', async () => {
    const updateSettings = vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, launchAtLogin: true })
    installEdge({ updateSettings })
    useStore.getState().setLaunchAtLogin(true)
    expect(useStore.getState().settings.launchAtLogin).toBe(true)
    expect(updateSettings).toHaveBeenCalledWith({ launchAtLogin: true })
  })
})

describe('usage-only item pushes', () => {
  const item = (id: string, capturedAt: number): ClipboardItemDto => ({ id, data: { kind: 'text', text: id, isUrl: false }, capturedAt, hitCount: 1, pinned: false } as ClipboardItemDto)

  it('marks a usage reorder of known items', () => {
    useStore.getState().setItems([item('a', 1), item('b', 2)])
    expect(useStore.getState().itemsUsageOnly).toBe(false)
    useStore.getState().setItems([item('b', 3), item('a', 1)], { reason: 'usage' })
    expect(useStore.getState().itemsUsageOnly).toBe(true)
  })

  it('does not mark a capture or a usage push that brings a new item', () => {
    useStore.getState().setItems([item('a', 1)])
    useStore.getState().setItems([item('n', 5), item('a', 1)], { reason: 'usage' })
    expect(useStore.getState().itemsUsageOnly).toBe(false)
    useStore.getState().setItems([item('a', 6), item('n', 5)], { reason: 'capture' })
    expect(useStore.getState().itemsUsageOnly).toBe(false)
  })
})
