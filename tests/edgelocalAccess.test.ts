import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectItemFilePaths, isPathInside, isServableLocalPath, resolveRealPath } from '../electron/main/edgelocalAccess'
import type { ItemData } from '../shared/types'

const items: Array<{ data: ItemData }> = [
  { data: { kind: 'text', text: '/etc/passwd', isUrl: false } },
  { data: { kind: 'files', paths: ['/Users/me/Desktop/photo.png', '/Users/me/Documents/a/../report.pdf'] } },
  { data: { kind: 'image', imageId: 'abc', width: 1, height: 1, bytes: 1 } as ItemData },
  { data: { kind: 'files', paths: ['/Users/me/Movies/clip.mov'] } }
]

const roots = [
  '/Users/me/Library/Application Support/edge-drop/images',
  '/Users/me/Library/Application Support/edge-drop/thumbnails',
  '/Users/me/Library/Application Support/edge-drop/temp'
]

describe('edgelocal path allow-list', () => {
  const allowed = { itemPaths: collectItemFilePaths(items), roots }

  it('collects normalized paths of file items only', () => {
    expect([...allowed.itemPaths].sort()).toEqual([
      '/Users/me/Desktop/photo.png',
      '/Users/me/Documents/report.pdf',
      '/Users/me/Movies/clip.mov'
    ])
  })

  it('serves files that belong to history items', () => {
    expect(isServableLocalPath('/Users/me/Desktop/photo.png', allowed)).toBe(true)
    expect(isServableLocalPath('/Users/me/Documents/report.pdf', allowed)).toBe(true)
    expect(isServableLocalPath('/Users/me/Desktop/./photo.png', allowed)).toBe(true)
  })

  it('serves stored images, thumbnails and staged temp files', () => {
    expect(isServableLocalPath(`${roots[0]}/abc.png`, allowed)).toBe(true)
    expect(isServableLocalPath(`${roots[1]}/abc.jpg`, allowed)).toBe(true)
    expect(isServableLocalPath(`${roots[2]}/drag-1/Screenshot.png`, allowed)).toBe(true)
  })

  it('refuses any other path', () => {
    expect(isServableLocalPath('/etc/passwd', allowed)).toBe(false)
    expect(isServableLocalPath('/Users/me/.ssh/id_ed25519', allowed)).toBe(false)
    expect(isServableLocalPath('/Users/me/Desktop/other.png', allowed)).toBe(false)
    expect(isServableLocalPath('/Users/me/Desktop', allowed)).toBe(false)
    expect(isServableLocalPath('/Users/me/Library/Application Support/edge-drop/items.json', allowed)).toBe(false)
  })

  it('does not let a path climb out of an allowed directory', () => {
    expect(isServableLocalPath(`${roots[0]}/../items.json`, allowed)).toBe(false)
    expect(isServableLocalPath(`${roots[2]}/../../../../.ssh/id_ed25519`, allowed)).toBe(false)
    expect(isServableLocalPath(`${roots[0]}-evil/abc.png`, allowed)).toBe(false)
    expect(isServableLocalPath(roots[0], allowed)).toBe(false)
  })

  it('refuses empty and NUL-containing paths', () => {
    expect(isServableLocalPath('', allowed)).toBe(false)
    expect(isServableLocalPath('/Users/me/Desktop/photo.png\0.txt', allowed)).toBe(false)
  })

  it('refuses everything when the history is empty and the path is outside the app folders', () => {
    const empty = { itemPaths: collectItemFilePaths([]), roots }
    expect(isServableLocalPath('/Users/me/Desktop/photo.png', empty)).toBe(false)
    expect(isServableLocalPath(`${roots[0]}/abc.png`, empty)).toBe(true)
  })

  it('isPathInside needs a real child path', () => {
    expect(isPathInside('/a/b', '/a/b/c')).toBe(true)
    expect(isPathInside('/a/b/', '/a/b/c')).toBe(true)
    expect(isPathInside('/a/b', '/a/b')).toBe(false)
    expect(isPathInside('/a/b', '/a/bc')).toBe(false)
    expect(isPathInside('', '/a')).toBe(false)
  })
})

describe('edgelocal allow-list on the real file system', () => {
  let base = ''

  afterEach(() => {
    if (base) rmSync(base, { recursive: true, force: true })
    base = ''
  })

  function setup(): { root: string; outside: string } {
    base = mkdtempSync(join(tmpdir(), 'ed-edgelocal-'))
    const root = join(base, 'images')
    const outside = join(base, 'secret')
    mkdirSync(root)
    mkdirSync(outside)
    writeFileSync(join(root, 'abc.png'), 'png')
    writeFileSync(join(outside, 'key'), 'secret')
    return { root, outside }
  }

  it('refuses a symlink inside an allowed folder that points outside it', () => {
    const { root, outside } = setup()
    symlinkSync(join(outside, 'key'), join(root, 'evil.png'))
    symlinkSync(outside, join(root, 'dir'))
    const allowed = { itemPaths: new Set<string>(), roots: [root] }
    expect(isServableLocalPath(join(root, 'abc.png'), allowed)).toBe(true)
    expect(isServableLocalPath(join(root, 'evil.png'), allowed)).toBe(false)
    expect(isServableLocalPath(join(root, 'dir', 'key'), allowed)).toBe(false)
  })

  it('uses a supplied root resolver once per root and keeps the same verdicts', () => {
    const { root, outside } = setup()
    symlinkSync(join(outside, 'key'), join(root, 'evil.png'))
    const linkedRoot = join(base, 'linked')
    symlinkSync(root, linkedRoot)
    const resolved = new Map<string, string>()
    const resolveRoot = vi.fn((rootDir: string) => {
      let real = resolved.get(rootDir)
      if (real === undefined) {
        real = resolveRealPath(rootDir)
        resolved.set(rootDir, real)
      }
      return real
    })
    const allowed = { itemPaths: new Set<string>(), roots: ['', linkedRoot], resolveRoot }
    expect(isServableLocalPath(join(linkedRoot, 'abc.png'), allowed)).toBe(true)
    expect(isServableLocalPath(join(root, 'evil.png'), allowed)).toBe(false)
    expect(isServableLocalPath(join(outside, 'key'), allowed)).toBe(false)
    expect(resolveRoot.mock.calls.every(([rootDir]) => rootDir === linkedRoot)).toBe(true)
    expect(resolved.size).toBe(1)
  })

  it('accepts a root given through a symlink and a file that does not exist yet', () => {
    const { root } = setup()
    const linkedRoot = join(base, 'linked-images')
    symlinkSync(root, linkedRoot)
    expect(isPathInside(linkedRoot, join(root, 'abc.png'))).toBe(true)
    expect(isPathInside(root, join(linkedRoot, 'abc.png'))).toBe(true)
    expect(isPathInside(root, join(root, 'later', 'new.png'))).toBe(true)
    expect(isPathInside(root, join(base, 'images-evil', 'x.png'))).toBe(false)
  })

  it('resolves the existing part of a missing path', () => {
    const { root } = setup()
    expect(resolveRealPath(join(root, 'missing', 'x.png'))).toBe(join(realpathSync.native(root), 'missing', 'x.png'))
    expect(resolveRealPath('/definitely-missing-edge-drop/x')).toBe('/definitely-missing-edge-drop/x')
  })
})
