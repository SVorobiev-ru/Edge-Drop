import { describe, expect, it } from 'vitest'
import { formatBytes, imageItemDisplayName } from '../src/lib/format'

describe('formatBytes', () => {
  it('uses binary units outside macOS', () => {
    expect(formatBytes(512, false)).toBe('512 B')
    expect(formatBytes(1023, false)).toBe('1023 B')
    expect(formatBytes(1024, false)).toBe('1.0 KB')
    expect(formatBytes(1536, false)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024, false)).toBe('5.0 MB')
  })

  it('switches to GB instead of thousands of MB', () => {
    expect(formatBytes(5 * 1024 ** 3, false)).toBe('5.0 GB')
    expect(formatBytes(1024 ** 3 - 1, false)).toBe('1024.0 MB')
    expect(formatBytes(5_000_000_000, true)).toBe('5.0 GB')
  })

  it('uses decimal units like Finder on macOS', () => {
    expect(formatBytes(999, true)).toBe('999 B')
    expect(formatBytes(1000, true)).toBe('1.0 KB')
    expect(formatBytes(1024, true)).toBe('1.0 KB')
    expect(formatBytes(1_500_000, true)).toBe('1.5 MB')
    expect(formatBytes(2_340_000_000, true)).toBe('2.3 GB')
  })

  it('defaults to the base of the current platform', () => {
    const decimal = process.platform === 'darwin'
    expect(formatBytes(1000)).toBe(decimal ? '1.0 KB' : '1000 B')
  })
})

describe('imageItemDisplayName', () => {
  it('prefers the original file name', () => {
    expect(imageItemDisplayName({ imageId: 'abc', fileName: 'Holiday.png' }, 1)).toBe('Holiday.png')
  })

  it('falls back to a typed label for clipboard images', () => {
    expect(imageItemDisplayName({ imageId: 'abc', source: 'screenshot' })).toBe('Screenshot')
    expect(imageItemDisplayName({ imageId: 'abc', source: 'image' })).toBe('Image')
    expect(imageItemDisplayName({ imageId: 'abc', source: 'image' }, Date.UTC(2026, 0, 15, 12))).toMatch(/^Image .+/)
  })
})
