import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { isValidFilePath } from '../electron/main/pathValidation'
import { restorePlatform, setPlatform } from './helpers/platform'

const WINDOWS_RESERVED = ['/Users/a/what?.txt', '/Users/a/a*b.txt', '/Users/a/a<b.txt', '/Users/a/a>b.txt', '/Users/a/a|b.txt', '/Users/a/"q".txt']

describe('isValidFilePath per platform', () => {
  afterEach(() => {
    restorePlatform()
  })

  afterAll(() => {
    restorePlatform()
  })

  it('accepts * ? < > | " in names on darwin', () => {
    setPlatform('darwin')
    for (const p of WINDOWS_RESERVED) expect(isValidFilePath(p)).toBe(true)
  })

  it('accepts * ? < > | " in names on linux', () => {
    setPlatform('linux')
    for (const p of WINDOWS_RESERVED) expect(isValidFilePath(p)).toBe(true)
  })

  it('still rejects * ? < > | " on win32', () => {
    setPlatform('win32')
    for (const p of WINDOWS_RESERVED) expect(isValidFilePath(p)).toBe(false)
    for (const p of ['C:\\a\\what?.txt', 'C:\\a\\a*b.txt', 'C:\\a\\a<b.txt', 'C:\\a\\a>b.txt', 'C:\\a\\a|b.txt', 'C:\\a\\"q".txt']) {
      expect(isValidFilePath(p)).toBe(false)
    }
    expect(isValidFilePath('C:\\Users\\a\\file.txt')).toBe(true)
  })

  it('rejects control characters and NUL on every platform', () => {
    for (const platform of ['darwin', 'linux', 'win32']) {
      setPlatform(platform)
      expect(isValidFilePath('/Users/a/a\u0000b.txt')).toBe(false)
      expect(isValidFilePath('/Users/a/a\nb.txt')).toBe(false)
      expect(isValidFilePath('/Users/a/a\u001fb.txt')).toBe(false)
      expect(isValidFilePath('/Users/a/a\u007fb.txt')).toBe(false)
    }
  })

  it('rejects non-strings, empty and oversized paths on every platform', () => {
    for (const platform of ['darwin', 'win32']) {
      setPlatform(platform)
      expect(isValidFilePath(undefined)).toBe(false)
      expect(isValidFilePath(42)).toBe(false)
      expect(isValidFilePath('   ')).toBe(false)
      expect(isValidFilePath('a'.repeat(32768))).toBe(false)
    }
  })
})
