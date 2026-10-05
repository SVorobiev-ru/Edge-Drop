import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClipboardWatcher, type CapturePolicy } from '../electron/clipboard/ClipboardWatcher'
import * as formats from '../electron/clipboard/formats'
import type { ItemData } from '../shared/types'
import { restorePlatform, setPlatform } from './helpers/platform'

describe('capture policy', () => {
  let watcher: ClipboardWatcher
  let seq = 100
  let item: ItemData = { kind: 'text', text: 'Hello', isUrl: false }
  let front: { bundleId: string; name?: string; pid?: number } | null = null
  let ignored: string[] = []
  let ignoreRemote = false
  let remote = false
  let readClipboard: ReturnType<typeof vi.spyOn>
  let policy: CapturePolicy

  beforeEach(() => {
    setPlatform('darwin')
    vi.useFakeTimers()
    seq = 100
    item = { kind: 'text', text: 'Hello', isUrl: false }
    front = { bundleId: 'com.apple.Safari', name: 'Safari', pid: 4242 }
    ignored = []
    ignoreRemote = false
    remote = false
    vi.spyOn(formats, 'getClipboardSequenceNumber').mockImplementation(() => seq)
    vi.spyOn(formats, 'clipboardSignature').mockImplementation(() => `seq:${seq}:text`)
    readClipboard = vi.spyOn(formats, 'readClipboard').mockImplementation(async () => item)
    vi.spyOn(formats, 'clipboardHasFileNameW').mockImplementation(() => false)
    vi.spyOn(formats, 'clipboardTextContent').mockImplementation(() => (item.kind === 'text' ? item.text : null))
    vi.spyOn(formats, 'clipboardFilesContentKey').mockImplementation(() => null)
    vi.spyOn(formats, 'isRemoteClipboard').mockImplementation(() => remote)
    policy = {
      frontmostApp: vi.fn(() => front),
      ownBundleId: () => 'com.edgedrop.app',
      ignoredApps: () => ignored,
      ignoreRemoteClipboard: () => ignoreRemote
    }
  })

  afterEach(() => {
    watcher?.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
    restorePlatform()
  })

  afterAll(() => {
    restorePlatform()
  })

  async function start(withPolicy = true) {
    const onNew = vi.fn()
    const onHint = vi.fn()
    watcher = new ClipboardWatcher(50, 200)
    if (withPolicy) watcher.setCapturePolicy(policy)
    watcher.start(onNew, onHint)
    await vi.advanceTimersByTimeAsync(60)
    return { onNew, onHint }
  }

  async function copy(text: string) {
    seq++
    item = { kind: 'text', text, isUrl: false }
    await vi.advanceTimersByTimeAsync(60)
  }

  async function settle() {
    await vi.advanceTimersByTimeAsync(260)
  }

  it('passes the frontmost app as the source of a capture', async () => {
    const { onNew } = await start()
    await copy('from safari')
    await settle()

    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onNew).toHaveBeenCalledWith(item, undefined, undefined, { bundleId: 'com.apple.Safari', name: 'Safari' })
  })

  it('remembers the app that was in front when the change was seen, not after the settle delay', async () => {
    const { onNew } = await start()
    await copy('quick switch')
    front = { bundleId: 'com.apple.Notes', name: 'Notes', pid: 5151 }
    await settle()

    expect(onNew.mock.calls[0][3]).toEqual({ bundleId: 'com.apple.Safari', name: 'Safari' })
  })

  it('takes a fresh snapshot for the next copy', async () => {
    const { onNew } = await start()
    await copy('one')
    await settle()
    await vi.advanceTimersByTimeAsync(600)
    front = { bundleId: 'com.apple.Notes', name: 'Notes', pid: 5151 }
    await copy('two')
    await settle()

    expect(onNew).toHaveBeenCalledTimes(2)
    expect(onNew.mock.calls[1][3]).toEqual({ bundleId: 'com.apple.Notes', name: 'Notes' })
  })

  it('omits the source when Edge-Drop itself is in front', async () => {
    const { onNew } = await start()
    front = { bundleId: 'com.edgedrop.app', name: 'Edge-Drop', pid: 777 }
    await copy('own bundle')
    await settle()
    await vi.advanceTimersByTimeAsync(600)
    front = { bundleId: 'com.github.Electron', name: 'Electron', pid: process.pid }
    await copy('own pid')
    await settle()

    expect(onNew).toHaveBeenCalledTimes(2)
    expect(onNew.mock.calls[0]).toHaveLength(1)
    expect(onNew.mock.calls[1]).toHaveLength(1)
  })

  it('captures without a source when the frontmost app is unknown', async () => {
    const { onNew } = await start()
    front = null
    await copy('nobody')
    await settle()

    expect(onNew).toHaveBeenCalledWith(item)
  })

  it('does not capture a copy made in an ignored app and does not flare', async () => {
    ignored = ['com.agilebits.onepassword7', 'com.apple.Safari']
    const { onNew, onHint } = await start()
    await copy('password')
    await settle()
    await vi.advanceTimersByTimeAsync(2000)

    expect(onNew).not.toHaveBeenCalled()
    expect(onHint).not.toHaveBeenCalled()
    expect(readClipboard).not.toHaveBeenCalled()
  })

  it('does not capture the ignored content later once another app is in front', async () => {
    ignored = ['com.apple.Safari']
    const { onNew } = await start()
    await copy('password')
    front = { bundleId: 'com.apple.Notes', name: 'Notes', pid: 5151 }
    await vi.advanceTimersByTimeAsync(3000)

    expect(onNew).not.toHaveBeenCalled()
    expect(readClipboard).not.toHaveBeenCalled()

    await copy('a real copy')
    await settle()
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onNew.mock.calls[0][3]).toEqual({ bundleId: 'com.apple.Notes', name: 'Notes' })
  })

  it('drops a settling capture when an ignored app copies before it settles', async () => {
    ignored = ['com.agilebits.onepassword7']
    const { onNew } = await start()
    await copy('from safari')
    front = { bundleId: 'com.agilebits.onepassword7', name: '1Password', pid: 6000 }
    await copy('password')
    await settle()
    await vi.advanceTimersByTimeAsync(2000)

    expect(onNew).not.toHaveBeenCalled()
    expect(readClipboard).not.toHaveBeenCalled()
  })

  it('skips a Handoff clipboard without reading it when the setting is on', async () => {
    ignoreRemote = true
    remote = true
    const { onNew, onHint } = await start()
    const text = vi.mocked(formats.clipboardTextContent)
    text.mockClear()
    await copy('from the phone')
    await settle()
    await vi.advanceTimersByTimeAsync(2000)

    expect(onNew).not.toHaveBeenCalled()
    expect(onHint).not.toHaveBeenCalled()
    expect(readClipboard).not.toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
    expect(policy.frontmostApp).not.toHaveBeenCalled()
  })

  it('skips a Handoff clipboard that appears while an earlier copy is settling', async () => {
    ignoreRemote = true
    const { onNew } = await start()
    await copy('local')
    remote = true
    seq++
    await vi.advanceTimersByTimeAsync(60)
    await settle()

    expect(onNew).not.toHaveBeenCalled()
    expect(readClipboard).not.toHaveBeenCalled()
  })

  it('captures a Handoff clipboard when the setting is off', async () => {
    remote = true
    const { onNew } = await start()
    await copy('from the phone')
    await settle()

    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('keeps the old handler arguments when no policy is set', async () => {
    const { onNew } = await start(false)
    await copy('plain')
    await settle()

    expect(onNew).toHaveBeenCalledWith(item)
    expect(policy.frontmostApp).not.toHaveBeenCalled()
  })

  it('ignores the policy off darwin', async () => {
    setPlatform('win32')
    ignored = ['com.apple.Safari']
    ignoreRemote = true
    remote = true
    const { onNew } = await start()
    await copy('windows')
    await settle()

    expect(onNew).toHaveBeenCalledWith(item)
    expect(policy.frontmostApp).not.toHaveBeenCalled()
  })
})
