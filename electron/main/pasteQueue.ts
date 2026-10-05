import { DEFAULT_PASTE_QUEUE_HOTKEY } from '../../shared/types'

export type QueuePasteResult = 'pasted' | 'busy' | 'failed'

export interface PasteQueueDeps {
  accelerator(): string
  register(accelerator: string, handler: () => void): boolean
  unregister(accelerator: string): void
  isRegistered(accelerator: string): boolean
  exists(id: string): boolean
  paste(id: string): Promise<QueuePasteResult>
  publish(ids: string[]): void
  toast(key: string, params?: Record<string, string | number>): void
}

export class PasteQueue {
  private ids: string[] = []
  private registered: string | null = null
  private pasting = false
  private pendingPresses = 0
  private takenWarned: string | null = null

  constructor(private readonly deps: PasteQueueDeps) {}

  list(): string[] {
    return [...this.ids]
  }

  add(id: string): string[] {
    if (!this.deps.exists(id)) return this.list()
    if (!this.ids.includes(id)) {
      this.ids.push(id)
      this.changed()
    }
    this.deps.toast('toast.queueAdded', { count: this.ids.length })
    return this.list()
  }

  clear(): void {
    if (this.ids.length === 0) {
      this.syncShortcut()
      return
    }
    this.ids = []
    this.pendingPresses = 0
    this.changed()
  }

  prune(): void {
    const kept = this.ids.filter((id) => this.deps.exists(id))
    if (kept.length === this.ids.length) return
    this.ids = kept
    this.changed()
  }

  async pasteNext(): Promise<boolean> {
    if (this.pasting) {
      if (this.pendingPresses < this.ids.length - 1) this.pendingPresses++
      return false
    }
    this.prune()
    const id = this.ids[0]
    if (!id) {
      this.pendingPresses = 0
      return false
    }
    this.pasting = true
    try {
      const result = await this.deps.paste(id)
      if (result === 'busy') {
        this.pendingPresses = 0
        this.deps.toast('toast.queuePasteBusy')
        return false
      }
      this.ids = this.ids.filter((x) => x !== id)
      this.changed()
      if (this.ids.length === 0) this.deps.toast('toast.queueEmpty')
      return result === 'pasted'
    } finally {
      this.pasting = false
      if (this.pendingPresses > 0) {
        this.pendingPresses--
        void this.pasteNext()
      }
    }
  }

  syncShortcut(): void {
    const wanted = this.ids.length > 0 ? this.deps.accelerator() || DEFAULT_PASTE_QUEUE_HOTKEY : null
    if (this.registered && (this.registered !== wanted || !this.deps.isRegistered(this.registered))) {
      try {
        if (this.deps.isRegistered(this.registered)) this.deps.unregister(this.registered)
      } catch { /* ignore */ }
      this.registered = null
    }
    if (!wanted) {
      this.takenWarned = null
      return
    }
    if (this.registered) return
    let ok = false
    try {
      ok = this.deps.register(wanted, () => void this.pasteNext())
    } catch {
      ok = false
    }
    if (ok) {
      this.registered = wanted
      this.takenWarned = null
    } else if (this.takenWarned !== wanted) {
      this.takenWarned = wanted
      this.deps.toast('toast.shortcutTaken')
    }
  }

  private changed(): void {
    this.syncShortcut()
    this.deps.publish(this.list())
  }
}
