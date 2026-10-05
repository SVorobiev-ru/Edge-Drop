import { sendToMainWindow } from './window'

/** Fire a transient toast to the renderer (best-effort; renderer may be closed). Message is a translation key resolved renderer-side; params fill {placeholders}. */
export function toast(message: string, tone: 'info' | 'error' = 'info', params?: Record<string, string | number>): void {
  sendToMainWindow('ui:toast', { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, message, tone, params })
}
