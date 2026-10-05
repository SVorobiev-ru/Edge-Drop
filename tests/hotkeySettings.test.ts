import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hotkeyFailureMessageKey, isReservedMacAccelerator, normalizeMacAccelerator, sameMacAccelerator } from '../src/components/settings/hotkeys'

const store = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  patchSettings: vi.fn(),
  setSettings: vi.fn(),
  pushToast: vi.fn()
}))

vi.mock('../src/lib/soundEffects', () => ({
  playToggleSound: vi.fn(),
  playButtonClickSound: vi.fn()
}))

vi.mock('../src/components/icons', () => ({
  RotateCcwIcon: () => null,
  CloseIcon: () => null
}))

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../src/store/appStore', () => ({
  useStore: Object.assign((select: (state: typeof store) => unknown) => select(store), { getState: () => store })
}))

vi.mock('../src/components/settings/layout', () => ({
  useSettingsLayout: () => ({ isHorizontal: false, titleId: (name: string) => name, cardClass: () => 'setting-card' })
}))

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')

describe('reserved mac shortcuts', () => {
  it.each([
    'Super+C', 'Super+V', 'Super+X', 'Super+A', 'Super+Z', 'Super+Q', 'Super+W', 'Super+H', 'Super+M',
    'Super+,', 'Super+Tab', 'Super+Space', 'Ctrl+Space', 'Shift+Super+3', 'Shift+Super+4', 'Shift+Super+5',
    'Command+S', 'CommandOrControl+F', 'Ctrl+Shift+Super+4'
  ])('rejects %s', (accelerator) => {
    expect(isReservedMacAccelerator(accelerator)).toBe(true)
  })

  it.each(['Command+Shift+V', 'Command+Control+V', 'Alt+C', 'Super+Alt+K', 'F13', 'Ctrl+Shift+X', 'Super+1'])('allows %s', (accelerator) => {
    expect(isReservedMacAccelerator(accelerator)).toBe(false)
  })

  it('normalizes modifier aliases', () => {
    expect(normalizeMacAccelerator('Shift+Super+c')).toEqual({ modifiers: ['cmd', 'shift'], key: 'C' })
    expect(normalizeMacAccelerator('Option+Control+Space')).toEqual({ modifiers: ['ctrl', 'alt'], key: 'Space' })
  })

  it('maps main-process failure reasons to toasts', () => {
    expect(hotkeyFailureMessageKey('reserved')).toBe('toast.shortcutReserved')
    expect(hotkeyFailureMessageKey('taken')).toBe('toast.shortcutTaken')
    expect(hotkeyFailureMessageKey('invalid')).toBe('toast.shortcutTaken')
  })
})

describe('hotkey recorder keys', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const key = (code: string, extra: Partial<KeyboardEvent> = {}) =>
    ({ code, key: code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...extra }) as KeyboardEvent

  it('recognizes F13–F19 as standalone shortcuts', async () => {
    vi.resetModules()
    vi.stubGlobal('window', { edge: { platform: 'darwin' } })
    const { eventToAccelerator } = await import('../src/components/HotkeyRecorder')
    for (const code of ['F1', 'F12', 'F13', 'F16', 'F19']) {
      expect(eventToAccelerator(key(code))).toMatchObject({ accelerator: code, isValid: true })
    }
    expect(eventToAccelerator(key('F20')).isValid).toBe(false)
    expect(eventToAccelerator(key('KeyV', { metaKey: true, shiftKey: true })).accelerator).toBe('Shift+Super+V')
  })

  it('checks the reserved list on darwin before calling onChange', () => {
    const src = read('src/components/HotkeyRecorder.tsx')
    const guard = src.indexOf('IS_DARWIN && isReservedMacAccelerator(accelerator)')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(src.indexOf('onChange(accelerator)'))
  })
})

describe('hotkeys on macOS', () => {
  it('compares accelerators regardless of modifier spelling and order', () => {
    expect(sameMacAccelerator('Command+Control+V', 'Ctrl+Super+v')).toBe(true)
    expect(sameMacAccelerator('Command+Shift+V', 'Command+Control+V')).toBe(false)
    expect(sameMacAccelerator('Command+Shift', 'Command+Shift')).toBe(false)
  })

  describe('shortcut cards', () => {
    type Element = { type: unknown; props: Record<string, any> }
    type Cards = typeof import('../src/components/settings/HotkeyCards')

    let setHotkey: ReturnType<typeof vi.fn>

    async function renderCard(platform: string, settings: Record<string, unknown>, card: keyof Cards = 'PasteQueueHotkeyCard'): Promise<Element> {
      vi.resetModules()
      vi.stubGlobal('window', { edge: { platform, setHotkey } })
      store.settings = settings
      const cards = await import('../src/components/settings/HotkeyCards')
      return (cards[card] as () => unknown)() as Element
    }

    function elements(node: unknown): Element[] {
      if (Array.isArray(node)) return node.flatMap(elements)
      if (!node || typeof node !== 'object' || !('props' in node)) return []
      const element = node as Element
      return [element, ...elements(element.props.children)]
    }

    function conflictHints(card: Element): Element[] {
      const body = (card.type as (props: Record<string, any>) => unknown)(card.props)
      return elements(body).filter((el) => el.props.className === 'setting-desc hotkey-conflict-hint')
    }

    beforeEach(() => {
      setHotkey = vi.fn()
      store.patchSettings.mockReset()
      store.setSettings.mockReset()
      store.pushToast.mockReset()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('rejects the toggle shortcut for the queue in any spelling', async () => {
      const card = await renderCard('darwin', { toggleHotkey: 'Command+Shift+V', pasteQueueHotkey: 'Command+Control+V' })
      card.props.onChange('Shift+Super+v')
      expect(store.patchSettings).not.toHaveBeenCalled()
      expect(store.pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'toast.shortcutTaken', tone: 'error' }))
    })

    it('compares with the mac default when no toggle shortcut is saved', async () => {
      const card = await renderCard('darwin', { pasteQueueHotkey: 'Command+Control+V' })
      card.props.onChange('Command+Shift+V')
      expect(store.patchSettings).not.toHaveBeenCalled()
      expect(store.pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'toast.shortcutTaken' }))
    })

    it('saves any other shortcut', async () => {
      const card = await renderCard('darwin', { toggleHotkey: 'Command+Shift+V', pasteQueueHotkey: 'Command+Control+V' })
      card.props.onChange('Command+Alt+P')
      expect(store.patchSettings).toHaveBeenCalledWith({ pasteQueueHotkey: 'Command+Alt+P' })
      expect(store.pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'toast.shortcutUpdated', tone: 'info' }))
    })

    it.each([
      ['darwin', 1],
      ['win32', 0]
    ])('shows the conflict hint under the recorder on %s', async (platform, count) => {
      const card = await renderCard(platform, { pasteQueueHotkey: 'Command+Control+V' })
      expect(conflictHints(card)).toHaveLength(count)
    })

    it('saves the toggle shortcut through main and reports success', async () => {
      setHotkey.mockResolvedValue({ ok: true, settings: { toggleHotkey: 'Command+Alt+V' } })
      const card = await renderCard('darwin', { toggleHotkey: 'Command+Shift+V' }, 'ToggleHotkeyCard')
      card.props.onChange('Command+Alt+V')
      await vi.waitFor(() => expect(store.pushToast).toHaveBeenCalled())
      expect(setHotkey).toHaveBeenCalledWith('Command+Alt+V')
      expect(store.setSettings).toHaveBeenCalledWith({ toggleHotkey: 'Command+Alt+V' })
      expect(store.pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'toast.shortcutUpdated', tone: 'info' }))
    })

    it.each([
      [{ ok: false, reason: 'reserved' }, 'toast.shortcutReserved', []],
      [{ ok: false, reason: 'taken', settings: { toggleHotkey: 'Command+Shift+V' } }, 'toast.shortcutTaken', [[{ toggleHotkey: 'Command+Shift+V' }]]]
    ])('reports a toggle shortcut refused by main: %j', async (result, message, savedSettings) => {
      setHotkey.mockResolvedValue(result)
      const card = await renderCard('darwin', { toggleHotkey: 'Command+Shift+V' }, 'ToggleHotkeyCard')
      card.props.onChange('Command+C')
      await vi.waitFor(() => expect(store.pushToast).toHaveBeenCalled())
      expect(setHotkey).toHaveBeenCalledWith('Command+C')
      expect(store.pushToast).toHaveBeenCalledWith(expect.objectContaining({ message, tone: 'error' }))
      expect(store.pushToast).toHaveBeenCalledTimes(1)
      expect(store.setSettings.mock.calls).toEqual(savedSettings)
    })

    it('reports a failed toggle shortcut call as taken', async () => {
      setHotkey.mockRejectedValue(new Error('ipc down'))
      const card = await renderCard('darwin', {}, 'ToggleHotkeyCard')
      card.props.onChange('Command+Alt+V')
      await vi.waitFor(() => expect(store.pushToast).toHaveBeenCalled())
      expect(store.pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'toast.shortcutTaken', tone: 'error' }))
      expect(store.setSettings).not.toHaveBeenCalled()
    })
  })
})
