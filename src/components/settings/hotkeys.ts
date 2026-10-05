const COMMAND = new Set(['Command', 'Cmd', 'CommandOrControl', 'CmdOrCtrl', 'Meta', 'Super'])
const CONTROL = new Set(['Control', 'Ctrl'])
const OPTION = new Set(['Alt', 'Option'])

const RESERVED_COMBOS = new Set([
  'cmd+Tab',
  'cmd+Space',
  'ctrl+Space',
  'cmd+ctrl+Space',
  'cmd+,',
  'cmd+shift+3',
  'cmd+shift+4',
  'cmd+shift+5',
  'cmd+ctrl+shift+3',
  'cmd+ctrl+shift+4',
  'cmd+ctrl+Q'
])

export function normalizeMacAccelerator(accelerator: string): { modifiers: string[]; key: string } {
  const parts = accelerator.split('+').map((part) => part.trim()).filter(Boolean)
  const modifiers = new Set<string>()
  let key = ''
  for (const part of parts) {
    if (COMMAND.has(part)) modifiers.add('cmd')
    else if (CONTROL.has(part)) modifiers.add('ctrl')
    else if (OPTION.has(part)) modifiers.add('alt')
    else if (part === 'Shift') modifiers.add('shift')
    else key = part.length === 1 ? part.toUpperCase() : part
  }
  return { modifiers: ['cmd', 'ctrl', 'alt', 'shift'].filter((m) => modifiers.has(m)), key }
}

export function isReservedMacAccelerator(accelerator: string): boolean {
  const { modifiers, key } = normalizeMacAccelerator(accelerator)
  if (!key) return false
  if (RESERVED_COMBOS.has([...modifiers, key].join('+'))) return true
  return modifiers.length === 1 && modifiers[0] === 'cmd' && /^[A-Z]$/.test(key)
}

export function sameMacAccelerator(a: string, b: string): boolean {
  const left = normalizeMacAccelerator(a)
  const right = normalizeMacAccelerator(b)
  return !!left.key && left.key === right.key && left.modifiers.join('+') === right.modifiers.join('+')
}

export function hotkeyFailureMessageKey(reason?: string): string {
  return reason === 'reserved' ? 'toast.shortcutReserved' : 'toast.shortcutTaken'
}
