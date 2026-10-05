import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registered: new Map<string, () => void>(),
  refuse: new Set<string>(),
  calls: [] as string[]
}))

vi.mock('electron', () => ({
  globalShortcut: {
    register: (acc: string, fn: () => void) => {
      mocks.calls.push(`register ${acc}`)
      if (mocks.refuse.has(acc)) return false
      mocks.registered.set(acc, fn)
      return true
    },
    unregister: (acc: string) => {
      mocks.calls.push(`unregister ${acc}`)
      mocks.registered.delete(acc)
    },
    isRegistered: (acc: string) => mocks.registered.has(acc)
  }
}))

import { normalizeAccelerator, sameAccelerator, trySwapGlobalShortcut, validateAccelerator } from '../electron/main/hotkeys'

beforeEach(() => {
  mocks.registered.clear()
  mocks.refuse.clear()
  mocks.calls.length = 0
})

describe('validateAccelerator on darwin', () => {
  it.each([
    'Command+C', 'Command+V', 'Command+X', 'Command+A', 'Command+Z', 'Command+Q', 'Command+W', 'Command+H', 'Command+M',
    'Command+,', 'Cmd+Tab', 'Command+Space', 'Ctrl+Space', 'Command+Shift+3', 'Shift+Command+4', 'Command+Shift+5',
    'Control+Command+Q', 'Command+Option+Esc', 'CommandOrControl+S', 'Cmd+F', 'Command+P'
  ])('rejects the reserved %s', (acc) => {
    expect(validateAccelerator(acc, 'darwin')).toEqual({ ok: false, reason: 'reserved' })
  })

  it.each(['Command+Shift+V', 'Command+Control+V', 'Alt+C', 'Command+Alt+Space', 'Control+Shift+Space', 'Command+Shift+Z', 'F13', 'Command+1'])(
    'accepts %s',
    (acc) => {
      expect(validateAccelerator(acc, 'darwin')).toEqual({ ok: true })
    }
  )

  it.each(['', '   ', 'V', 'Command+', 'Command+Command+V', 'Hyper+V', 'Command+Shift', 'Command+VV', 'Command+F25'])(
    'rejects the malformed %j',
    (acc) => {
      expect(validateAccelerator(acc, 'darwin')).toEqual({ ok: false, reason: 'invalid' })
    }
  )
})

describe('validateAccelerator on win32', () => {
  it('keeps mac reservations out of Windows', () => {
    expect(validateAccelerator('Command+C', 'win32')).toEqual({ ok: true })
    expect(validateAccelerator('Alt+C', 'win32')).toEqual({ ok: true })
  })

  it('still rejects malformed input', () => {
    expect(validateAccelerator('Alt+', 'win32')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('normalizeAccelerator', () => {
  it('orders modifiers and resolves aliases', () => {
    expect(normalizeAccelerator('shift+cmd+v', 'darwin')).toBe('Command+Shift+V')
    expect(normalizeAccelerator('Ctrl+Option+Return', 'darwin')).toBe('Control+Alt+Enter')
    expect(normalizeAccelerator('Command++', 'darwin')).toBe('Command+Plus')
    expect(normalizeAccelerator('CmdOrCtrl+K', 'win32')).toBe('Control+K')
  })

  it('compares accelerators written differently', () => {
    expect(sameAccelerator('Control+Command+V', 'Command+Control+V', 'darwin')).toBe(true)
    expect(sameAccelerator('Command+Shift+V', 'Command+Control+V', 'darwin')).toBe(false)
    expect(sameAccelerator(undefined, 'Command+Control+V', 'darwin')).toBe(false)
  })
})

describe('trySwapGlobalShortcut', () => {
  it('moves the handler from the previous accelerator to the new one', () => {
    const handler = vi.fn()
    mocks.registered.set('Alt+C', handler)

    expect(trySwapGlobalShortcut('Alt+C', 'Command+Shift+V', handler)).toBe(true)

    expect(mocks.calls).toEqual(['unregister Alt+C', 'register Command+Shift+V'])
    expect(mocks.registered.has('Alt+C')).toBe(false)
    expect(mocks.registered.get('Command+Shift+V')).toBe(handler)
  })

  it('restores the previous accelerator when the new one cannot be registered', () => {
    const handler = vi.fn()
    mocks.registered.set('Alt+C', handler)
    mocks.refuse.add('Command+Shift+V')

    expect(trySwapGlobalShortcut('Alt+C', 'Command+Shift+V', handler)).toBe(false)

    expect(mocks.calls).toEqual(['unregister Alt+C', 'register Command+Shift+V', 'register Alt+C'])
    expect(mocks.registered.get('Alt+C')).toBe(handler)
    expect(mocks.registered.has('Command+Shift+V')).toBe(false)
  })

  it('treats a throwing register as a failure', async () => {
    const electron = await import('electron')
    const spy = vi.spyOn(electron.globalShortcut, 'register').mockImplementationOnce(() => {
      throw new Error('bad accelerator')
    })
    const handler = vi.fn()

    expect(trySwapGlobalShortcut('Alt+C', 'Nope+X', handler)).toBe(false)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('works without a previous accelerator', () => {
    expect(trySwapGlobalShortcut(undefined, 'Command+Shift+V', vi.fn())).toBe(true)
    expect(mocks.calls).toEqual(['register Command+Shift+V'])
  })
})
