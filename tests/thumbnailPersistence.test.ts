import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { restorePlatform, setPlatform, withPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({ userData: '', createFromPath: 0 }))

function fakeImage(tag: string) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width: 1920, height: 1080 }),
    resize: () => ({ toPNG: () => Buffer.from(`thumb-${tag}`) }),
    toPNG: () => Buffer.from(`full-${tag}`)
  }
}

vi.mock('electron', async () => ({
  app: (await import('./helpers/electronMock')).userDataApp(() => mocks.userData),
  nativeImage: {
    createFromPath: vi.fn(() => {
      mocks.createFromPath++
      return fakeImage('decoded')
    })
  }
}))

import {
  clearThumbnailCache,
  getThumbnailPayload,
  persistStoredThumbnail
} from '../electron/main/thumbnailCache'

describe('persisted thumbnails', () => {
  let images: string
  let thumbnails: string

  beforeEach(() => {
    setPlatform('darwin')
    mocks.userData = join(tmpdir(), `ed-thumbs-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    images = join(mocks.userData, 'images')
    thumbnails = join(mocks.userData, 'thumbnails')
    mkdirSync(images, { recursive: true })
    mocks.createFromPath = 0
    clearThumbnailCache()
  })

  afterEach(() => {
    restorePlatform()
    rmSync(mocks.userData, { recursive: true, force: true })
  })

  function storedImage(imageId: string): string {
    const p = join(images, `${imageId}.png`)
    writeFileSync(p, `original-${imageId}`)
    return p
  }

  it('writes the thumbnail of a stored image to disk and reuses it after a restart without decoding the original', () => {
    const p = storedImage('abc123-def456')

    const first = getThumbnailPayload(p)!
    expect(first.body.toString()).toBe('thumb-decoded')
    expect(mocks.createFromPath).toBe(1)
    expect(readFileSync(join(thumbnails, 'abc123-def456.png'), 'utf8')).toBe('thumb-decoded')
    expect(readdirSync(thumbnails)).toEqual(['abc123-def456.png'])

    clearThumbnailCache()
    const second = getThumbnailPayload(p)!
    expect(mocks.createFromPath).toBe(1)
    expect(second.body.toString()).toBe('thumb-decoded')
    expect(second.etag).toBe(first.etag)
    expect(second.contentType).toBe('image/png')
  })

  it('serves a thumbnail prepared at capture time without ever decoding the original', () => {
    const p = storedImage('cap111-cap222')
    persistStoredThumbnail('cap111-cap222', fakeImage('capture') as any)

    expect(getThumbnailPayload(p)!.body.toString()).toBe('thumb-capture')
    expect(mocks.createFromPath).toBe(0)
  })

  it('rebuilds a persisted thumbnail that is older than its image', () => {
    persistStoredThumbnail('old111-old222', fakeImage('stale') as any)
    const p = storedImage('old111-old222')
    const future = new Date(Date.now() + 60_000)
    utimesSync(p, future, future)

    expect(getThumbnailPayload(p)!.body.toString()).toBe('thumb-decoded')
    expect(mocks.createFromPath).toBe(1)
  })

  it('does not persist thumbnails of files outside the image store', () => {
    const outside = join(mocks.userData, 'elsewhere')
    mkdirSync(outside, { recursive: true })
    const p = join(outside, 'photo.png')
    writeFileSync(p, 'photo')

    expect(getThumbnailPayload(p)).not.toBeNull()
    expect(existsSync(thumbnails)).toBe(false)

    clearThumbnailCache()
    getThumbnailPayload(p)
    expect(mocks.createFromPath).toBe(2)
  })

  it('keeps thumbnails in memory only on Windows', () => {
    const p = storedImage('win111-win222')
    const payload = withPlatform('win32', () => {
      persistStoredThumbnail('win111-win222', fakeImage('capture') as any)
      return getThumbnailPayload(p)
    })

    expect(payload!.body.toString()).toBe('thumb-decoded')
    expect(existsSync(thumbnails)).toBe(false)
    expect(mocks.createFromPath).toBe(1)
  })
})
