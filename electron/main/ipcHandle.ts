import { ipcMain } from 'electron'
import { type InvokeMap, type InvokeChannel } from '../../shared/ipc'

/**
 * Type-checked registration helper: guarantees the handler's return matches the
 * contract declared in InvokeMap.
 */
export function handle<C extends InvokeChannel>(
  channel: C,
  fn: (...args: InvokeMap[C]['args']) => Promise<InvokeMap[C]['result']> | InvokeMap[C]['result']
): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as InvokeMap[C]['args'])))
}
