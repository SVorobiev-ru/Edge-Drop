import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PasteQueue, type PasteQueueDeps, type QueuePasteResult } from '../electron/main/pasteQueue'

function makeDeps() {
  const registered = new Map<string, () => void>()
  const existing = new Set(['a', 'b', 'c'])
  const published: string[][] = []
  const toasts: Array<{ key: string; params?: Record<string, string | number> }> = []
  let accelerator = 'Command+Control+V'
  let refuse = false
  const paste = vi.fn(async (_id: string): Promise<QueuePasteResult> => 'pasted')
  const deps: PasteQueueDeps = {
    accelerator: () => accelerator,
    register: (acc, fn) => {
      if (refuse) return false
      registered.set(acc, fn)
      return true
    },
    unregister: (acc) => {
      registered.delete(acc)
    },
    isRegistered: (acc) => registered.has(acc),
    exists: (id) => existing.has(id),
    paste,
    publish: (ids) => {
      published.push(ids)
    },
    toast: (key, params) => {
      toasts.push(params ? { key, params } : { key })
    }
  }
  return {
    deps,
    registered,
    existing,
    published,
    toasts,
    paste,
    setAccelerator: (value: string) => {
      accelerator = value
    },
    setRefuse: (value: boolean) => {
      refuse = value
    }
  }
}

let env: ReturnType<typeof makeDeps>
let queue: PasteQueue

beforeEach(() => {
  env = makeDeps()
  queue = new PasteQueue(env.deps)
})

describe('PasteQueue', () => {
  it('registers the shortcut with the first item and publishes every change', () => {
    expect(queue.add('a')).toEqual(['a'])
    expect(queue.add('b')).toEqual(['a', 'b'])

    expect([...env.registered.keys()]).toEqual(['Command+Control+V'])
    expect(env.published).toEqual([['a'], ['a', 'b']])
    expect(env.toasts).toEqual([
      { key: 'toast.queueAdded', params: { count: 1 } },
      { key: 'toast.queueAdded', params: { count: 2 } }
    ])
  })

  it('does not queue the same item twice or unknown ids', () => {
    queue.add('a')
    queue.add('a')
    queue.add('zzz')

    expect(queue.list()).toEqual(['a'])
    expect(env.published).toEqual([['a']])
  })

  it('pastes in order, removes pasted ids and unregisters when empty', async () => {
    queue.add('a')
    queue.add('b')

    env.registered.get('Command+Control+V')!()
    await vi.waitFor(() => expect(queue.list()).toEqual(['b']))
    expect(env.paste).toHaveBeenLastCalledWith('a')
    expect(env.registered.size).toBe(1)

    await expect(queue.pasteNext()).resolves.toBe(true)
    expect(env.paste).toHaveBeenLastCalledWith('b')
    expect(queue.list()).toEqual([])
    expect(env.registered.size).toBe(0)
    expect(env.toasts.at(-1)).toEqual({ key: 'toast.queueEmpty' })
    expect(env.published.at(-1)).toEqual([])
  })

  it('keeps the head and tells the user when the paste guard reports busy', async () => {
    queue.add('a')
    env.paste.mockResolvedValueOnce('busy')

    await expect(queue.pasteNext()).resolves.toBe(false)
    expect(queue.list()).toEqual(['a'])
    expect(env.registered.size).toBe(1)
    expect(env.toasts.at(-1)).toEqual({ key: 'toast.queuePasteBusy' })
  })

  it('drops the head after a failed paste', async () => {
    queue.add('a')
    queue.add('b')
    env.paste.mockResolvedValueOnce('failed')

    await expect(queue.pasteNext()).resolves.toBe(false)
    expect(queue.list()).toEqual(['b'])
  })

  it('pastes a press made during a running paste once that paste finishes', async () => {
    queue.add('a')
    queue.add('b')
    queue.add('c')
    let release: (v: QueuePasteResult) => void = () => {}
    env.paste.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))

    const first = queue.pasteNext()
    await expect(queue.pasteNext()).resolves.toBe(false)
    expect(env.paste).toHaveBeenCalledTimes(1)
    release('pasted')
    await first

    await vi.waitFor(() => expect(queue.list()).toEqual(['c']))
    expect(env.paste.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })

  it('does not keep more pending presses than queued items', async () => {
    queue.add('a')
    queue.add('b')
    let release: (v: QueuePasteResult) => void = () => {}
    env.paste.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))

    const first = queue.pasteNext()
    await queue.pasteNext()
    await queue.pasteNext()
    await queue.pasteNext()
    release('pasted')
    await first

    await vi.waitFor(() => expect(queue.list()).toEqual([]))
    expect(env.paste).toHaveBeenCalledTimes(2)
    expect(env.toasts.filter((t) => t.key === 'toast.queueEmpty')).toHaveLength(1)
  })

  it('drops ids of deleted items on prune and before pasting', async () => {
    queue.add('a')
    queue.add('b')
    queue.add('c')
    env.existing.delete('b')

    queue.prune()
    expect(queue.list()).toEqual(['a', 'c'])

    env.existing.delete('a')
    await queue.pasteNext()
    expect(env.paste).toHaveBeenCalledWith('c')
    expect(queue.list()).toEqual([])
    expect(env.registered.size).toBe(0)
  })

  it('unregisters when every queued item was deleted', () => {
    queue.add('a')
    env.existing.delete('a')
    queue.prune()

    expect(queue.list()).toEqual([])
    expect(env.registered.size).toBe(0)
  })

  it('clears the queue and the shortcut', () => {
    queue.add('a')
    queue.clear()

    expect(queue.list()).toEqual([])
    expect(env.registered.size).toBe(0)
    expect(env.published.at(-1)).toEqual([])
  })

  it('moves the shortcut when the accelerator setting changes', () => {
    queue.add('a')
    env.setAccelerator('Command+Alt+V')
    queue.syncShortcut()

    expect([...env.registered.keys()]).toEqual(['Command+Alt+V'])
  })

  it('re-registers after something else unregistered every shortcut', () => {
    queue.add('a')
    env.registered.clear()
    queue.syncShortcut()

    expect([...env.registered.keys()]).toEqual(['Command+Control+V'])
  })

  it('warns once when the shortcut is taken and keeps the queue', () => {
    env.setRefuse(true)
    queue.add('a')
    queue.add('b')

    expect(queue.list()).toEqual(['a', 'b'])
    expect(env.toasts.filter((t) => t.key === 'toast.shortcutTaken')).toHaveLength(1)
  })
})
