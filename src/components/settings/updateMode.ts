import type { UpdateMode } from '../../../shared/types'

export function visibleUpdateModes(mac: boolean): UpdateMode[] {
  return mac ? ['notify', 'off'] : ['auto', 'notify', 'off']
}

export function displayedUpdateMode(mode: UpdateMode, mac: boolean): UpdateMode {
  return mac && mode === 'auto' ? 'notify' : mode
}
