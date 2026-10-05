import { globalShortcut } from 'electron'

export type AcceleratorCheck = { ok: true } | { ok: false; reason: 'reserved' | 'invalid' }

const MODIFIER_ALIASES: Record<string, string> = {
  command: 'Command',
  cmd: 'Command',
  control: 'Control',
  ctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl'
}

const NAMED_KEYS = [
  'Plus', 'Space', 'Tab', 'Capslock', 'Numlock', 'Scrolllock', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter',
  'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc', 'VolumeUp', 'VolumeDown',
  'VolumeMute', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause', 'PrintScreen',
  'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9',
  'numdec', 'numadd', 'numsub', 'nummult', 'numdiv'
]
const NAMED_KEY_LOOKUP = new Map(NAMED_KEYS.map((k) => [k.toLowerCase(), k]))
const KEY_ALIASES: Record<string, string> = { esc: 'Escape', return: 'Enter', ',': 'Comma' }
const PUNCTUATION = new Set([')', '!', '@', '#', '$', '%', '^', '&', '*', '(', ':', ';', '<', '=', '>', '?', '_', '-', '.', '/', '~', '`', '{', ']', '[', '|', '\\', '}', '"', "'"])
const MODIFIER_ORDER = ['Command', 'Control', 'Alt', 'AltGr', 'Shift', 'Super']

const DARWIN_RESERVED = new Set([
  'Command+C', 'Command+V', 'Command+X', 'Command+A', 'Command+Z', 'Command+Q', 'Command+W', 'Command+H', 'Command+M',
  'Command+Comma', 'Command+Tab', 'Command+Space', 'Control+Space',
  'Command+Shift+3', 'Command+Shift+4', 'Command+Shift+5',
  'Command+Control+Q', 'Command+Alt+Escape'
])

interface ParsedAccelerator {
  modifiers: string[]
  key: string
}

function normalizeKey(raw: string): string | null {
  const lower = raw.toLowerCase()
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower]
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase()
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(raw)) return raw.toUpperCase()
  if (PUNCTUATION.has(raw)) return raw
  return NAMED_KEY_LOOKUP.get(lower) ?? null
}

function parseAccelerator(acc: string, platform: NodeJS.Platform | string): ParsedAccelerator | null {
  if (typeof acc !== 'string' || !acc.trim()) return null
  const trimmed = acc.trim()
  const plusKey = trimmed.endsWith('++')
  const parts = (plusKey ? trimmed.slice(0, -2) : trimmed).split('+')
  const key = normalizeKey(plusKey ? 'Plus' : (parts.pop() ?? '').trim())
  if (!key) return null
  const modifiers = new Set<string>()
  for (const part of parts) {
    let mod = MODIFIER_ALIASES[part.trim().toLowerCase()]
    if (!mod) return null
    if (platform === 'darwin' && (mod === 'CommandOrControl' || mod === 'Super')) mod = 'Command'
    if (platform !== 'darwin' && mod === 'CommandOrControl') mod = 'Control'
    if (modifiers.has(mod)) return null
    modifiers.add(mod)
  }
  return { modifiers: MODIFIER_ORDER.filter((m) => modifiers.has(m)), key }
}

export function normalizeAccelerator(acc: string, platform: NodeJS.Platform | string = process.platform): string | null {
  const parsed = parseAccelerator(acc, platform)
  return parsed ? [...parsed.modifiers, parsed.key].join('+') : null
}

export function validateAccelerator(acc: string, platform: NodeJS.Platform | string = process.platform): AcceleratorCheck {
  const parsed = parseAccelerator(acc, platform)
  if (!parsed) return { ok: false, reason: 'invalid' }
  if (parsed.modifiers.length === 0 && !/^F\d+$/.test(parsed.key)) return { ok: false, reason: 'invalid' }
  if (platform !== 'darwin') return { ok: true }
  const normalized = [...parsed.modifiers, parsed.key].join('+')
  if (DARWIN_RESERVED.has(normalized)) return { ok: false, reason: 'reserved' }
  if (parsed.modifiers.length === 1 && parsed.modifiers[0] === 'Command' && /^[A-Z]$/.test(parsed.key)) {
    return { ok: false, reason: 'reserved' }
  }
  return { ok: true }
}

export function sameAccelerator(a: string | undefined, b: string | undefined, platform: NodeJS.Platform | string = process.platform): boolean {
  if (!a || !b) return false
  const na = normalizeAccelerator(a, platform)
  return na !== null && na === normalizeAccelerator(b, platform)
}

export function trySwapGlobalShortcut(prev: string | undefined, next: string, handler: () => void): boolean {
  if (prev) {
    try {
      if (globalShortcut.isRegistered(prev)) globalShortcut.unregister(prev)
    } catch { /* ignore */ }
  }
  let ok = false
  try {
    ok = globalShortcut.register(next, handler)
  } catch {
    ok = false
  }
  if (!ok && prev) {
    try {
      globalShortcut.register(prev, handler)
    } catch { /* ignore */ }
  }
  return ok
}
