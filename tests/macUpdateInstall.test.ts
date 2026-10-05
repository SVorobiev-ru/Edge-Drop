import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const exec = vi.hoisted(() => ({
  calls: [] as string[][],
  reply: (_args: string[]): { err?: Error; stdout?: string; stderr?: string } => ({})
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFile: (file: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      exec.calls.push([file, ...args])
      const out = exec.reply(args)
      cb(out.err ?? null, out.stdout ?? '', out.stderr ?? '')
    }
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/Applications/Edge-Drop.app/Contents/MacOS/Edge-Drop' },
  net: { request: vi.fn() }
}))

import {
  MAC_UPDATE_CHECKSUM_ASSET,
  buildMacInstallScript,
  currentAppBundle,
  macSignatureKind,
  macUpdateZipName,
  parseDesignatedRequirement,
  parseSha256Sums,
  selectMacUpdateAssets,
  shellQuote,
  verifyMacUpdateSignature
} from '../electron/main/macUpdateInstall'

const REPO = 'SVorobiev-ru/Edge-Drop'
const VERSION = '0.4.0-mac.1'
const BASE = `https://github.com/${REPO}/releases/download/v${VERSION}/`
const HASH = 'a'.repeat(64)

function asset(name: string, size = 1000, url = `${BASE}${name}`): Record<string, unknown> {
  return { name, size, browser_download_url: url }
}

const fullRelease = [
  asset(`Edge-Drop-${VERSION}-mac-arm64.dmg`),
  asset(`Edge-Drop-${VERSION}-mac-arm64.zip`, 120_000_000),
  asset(`Edge-Drop-${VERSION}-mac-x64.zip`, 130_000_000),
  asset(MAC_UPDATE_CHECKSUM_ASSET, 400)
]

describe('update asset selection', () => {
  it('names the ZIP after the version and the architecture', () => {
    expect(macUpdateZipName(VERSION, 'arm64')).toBe('Edge-Drop-0.4.0-mac.1-mac-arm64.zip')
  })

  it('picks the ZIP of the running architecture and the checksum file', () => {
    expect(selectMacUpdateAssets(fullRelease, VERSION, 'arm64', REPO)).toEqual({
      zip: { name: `Edge-Drop-${VERSION}-mac-arm64.zip`, url: `${BASE}Edge-Drop-${VERSION}-mac-arm64.zip`, size: 120_000_000 },
      checksums: { name: MAC_UPDATE_CHECKSUM_ASSET, url: `${BASE}${MAC_UPDATE_CHECKSUM_ASSET}`, size: 400 }
    })
    expect(selectMacUpdateAssets(fullRelease, VERSION, 'x64', REPO)?.zip.size).toBe(130_000_000)
  })

  it('refuses a release without the checksum file or without the ZIP', () => {
    expect(selectMacUpdateAssets(fullRelease.filter((a) => a.name !== MAC_UPDATE_CHECKSUM_ASSET), VERSION, 'arm64', REPO)).toBeNull()
    expect(selectMacUpdateAssets(fullRelease.filter((a) => !String(a.name).endsWith('arm64.zip')), VERSION, 'arm64', REPO)).toBeNull()
    expect(selectMacUpdateAssets(undefined, VERSION, 'arm64', REPO)).toBeNull()
  })

  it.each([
    ['another architecture', VERSION, 'ia32'],
    ['a version outside the fork scheme', '0.4.0', 'arm64'],
    ['a version with path characters', '0.4.0-mac.1/../x', 'arm64']
  ])('refuses %s', (_name, version, arch) => {
    expect(selectMacUpdateAssets(fullRelease, version, arch, REPO)).toBeNull()
  })

  it.each([
    `http://github.com/${REPO}/releases/download/v${VERSION}/Edge-Drop-${VERSION}-mac-arm64.zip`,
    `https://github.com.evil.example/${REPO}/releases/download/v${VERSION}/Edge-Drop-${VERSION}-mac-arm64.zip`,
    `https://github.com/evil/Edge-Drop/releases/download/v${VERSION}/Edge-Drop-${VERSION}-mac-arm64.zip`,
    `https://github.com/${REPO}/releases/download/v${VERSION}/other.zip`,
    `https://github.com/${REPO}/releases/download/v${VERSION}/Edge-Drop-${VERSION}-mac-arm64.zip?x=1`,
    `https://user@github.com/${REPO}/releases/download/v${VERSION}/Edge-Drop-${VERSION}-mac-arm64.zip`,
    `https://github.com/${REPO}/releases/download/v${VERSION}/../../../../evil/Edge-Drop-${VERSION}-mac-arm64.zip`,
    42
  ])('refuses an untrusted download URL: %s', (url) => {
    const release = [asset(`Edge-Drop-${VERSION}-mac-arm64.zip`, 1000, url as string), asset(MAC_UPDATE_CHECKSUM_ASSET, 400)]
    expect(selectMacUpdateAssets(release, VERSION, 'arm64', REPO)).toBeNull()
  })

  it.each([0, -1, 1.5, '100', 700 * 1024 * 1024])('refuses a ZIP with size %s', (size) => {
    const release = [{ ...asset(`Edge-Drop-${VERSION}-mac-arm64.zip`), size }, asset(MAC_UPDATE_CHECKSUM_ASSET, 400)]
    expect(selectMacUpdateAssets(release, VERSION, 'arm64', REPO)).toBeNull()
  })

  it('refuses an oversized checksum file', () => {
    const release = [asset(`Edge-Drop-${VERSION}-mac-arm64.zip`), asset(MAC_UPDATE_CHECKSUM_ASSET, 1024 * 1024)]
    expect(selectMacUpdateAssets(release, VERSION, 'arm64', REPO)).toBeNull()
  })
})

describe('checksum file parsing', () => {
  it('reads sha256sum output in text and binary mode', () => {
    const sums = parseSha256Sums([
      `${HASH}  Edge-Drop-${VERSION}-mac-arm64.zip`,
      `${'B'.repeat(64)} *Edge-Drop-${VERSION}-mac-x64.zip`,
      ''
    ].join('\n'))
    expect(sums.get(`Edge-Drop-${VERSION}-mac-arm64.zip`)).toBe(HASH)
    expect(sums.get(`Edge-Drop-${VERSION}-mac-x64.zip`)).toBe('b'.repeat(64))
  })

  it('accepts CRLF line endings', () => {
    expect(parseSha256Sums(`${HASH}  a.zip\r\n`).get('a.zip')).toBe(HASH)
  })

  it('ignores malformed lines and names with a path', () => {
    const sums = parseSha256Sums([
      `${'a'.repeat(63)}  short.zip`,
      `${'g'.repeat(64)}  nonhex.zip`,
      `${HASH} onespace.zip`,
      `${HASH}  dir/nested.zip`,
      `${HASH}  ..\\up.zip`,
      'garbage'
    ].join('\n'))
    expect(sums.size).toBe(0)
  })

  it('drops a name listed twice with different hashes', () => {
    const sums = parseSha256Sums(`${HASH}  a.zip\n${'c'.repeat(64)}  a.zip\n${HASH}  b.zip\n${HASH}  b.zip`)
    expect(sums.has('a.zip')).toBe(false)
    expect(sums.get('b.zip')).toBe(HASH)
  })
})

describe('installer script', () => {
  const input = {
    pid: 4242,
    target: "/Applications/Edge Drop's.app",
    source: '/var/folders/x/T/edge-drop-update-1/app/Edge-Drop.app',
    stage: "/Applications/.Edge Drop's.app.update-ab12",
    backup: "/Applications/.Edge Drop's.app.backup-ab12",
    workDir: '/var/folders/x/T/edge-drop-update-1',
    log: '/Users/me/Library/Logs/Edge-Drop/update.log'
  }

  it('quotes every path for the shell', () => {
    expect(shellQuote("a'b c")).toBe(`'a'\\''b c'`)
    const script = buildMacInstallScript(input)
    expect(script).toContain(`TARGET='/Applications/Edge Drop'\\''s.app'`)
    expect(script).toContain(`STAGE='/Applications/.Edge Drop'\\''s.app.update-ab12'`)
    expect(script).toContain(`BACKUP='/Applications/.Edge Drop'\\''s.app.backup-ab12'`)
    expect(script).toContain(`SOURCE='${input.source}'`)
    expect(script).toContain(`WORK='${input.workDir}'`)
    expect(script).toContain(`LOG='${input.log}'`)
    expect(script).toContain('PID=4242')
    for (const line of script.split('\n').slice(8)) {
      expect(line).not.toContain('/Applications/')
      expect(line).not.toContain('/var/folders/')
    }
  })

  it('waits for the app to exit, swaps through a sibling copy, relaunches and keeps a backup until the launch', () => {
    const script = buildMacInstallScript(input)
    const order = [
      'kill -0 "$PID"',
      '/usr/bin/ditto "$SOURCE" "$STAGE"',
      '/usr/bin/xattr -dr com.apple.quarantine "$STAGE"',
      '/bin/mv "$TARGET" "$BACKUP"',
      '/bin/mv "$STAGE" "$TARGET"',
      '/usr/bin/open "$TARGET" ||',
      'until running',
      '/bin/rm -rf "$BACKUP" "$WORK"'
    ].map((needle) => script.indexOf(needle))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(script).toContain('/bin/mv "$BACKUP" "$TARGET"')
  })

  it('waits 60 seconds for the new version and keeps it with the backup next to it on timeout', () => {
    const script = buildMacInstallScript(input)
    const timeout = script.split('\n').find((line) => line.includes('-gt 120 ]'))
    expect(timeout).toBeDefined()
    expect(timeout).not.toContain('restore')
    expect(timeout).toContain('exit 1')
    expect(timeout).not.toContain('"$BACKUP"')
    expect(timeout).toContain('/bin/rm -rf "$WORK"')
  })

  it.skipIf(process.platform === 'win32')('is valid sh', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edge-drop-script-'))
    try {
      const file = join(dir, 'install.sh')
      writeFileSync(file, buildMacInstallScript(input))
      expect(() => execFileSync('/bin/sh', ['-n', file])).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses an invalid pid', () => {
    expect(() => buildMacInstallScript({ ...input, pid: 0 })).toThrow()
    expect(() => buildMacInstallScript({ ...input, pid: 1.5 })).toThrow()
  })
})

describe('app bundle location', () => {
  it('resolves the bundle from the executable path', () => {
    expect(currentAppBundle('/Applications/Edge-Drop.app/Contents/MacOS/Edge-Drop')).toBe(resolve('/Applications/Edge-Drop.app'))
    expect(currentAppBundle('/Users/me/Apps/My Edge.app/Contents/MacOS/Edge-Drop')).toBe(resolve('/Users/me/Apps/My Edge.app'))
  })

  it('returns null outside an app bundle', () => {
    expect(currentAppBundle('/usr/local/bin/electron')).toBeNull()
    expect(currentAppBundle('/x/Edge-Drop.app/Contents/Frameworks/Helper')).toBeNull()
  })
})

const ADHOC_DETAILS = [
  'Executable=/Applications/Edge-Drop.app/Contents/MacOS/Edge-Drop',
  'Identifier=com.edgedrop.app',
  'CodeDirectory v=20400 size=297 flags=0x2(adhoc) hashes=3+3 location=embedded',
  'Signature=adhoc',
  'TeamIdentifier=not set'
].join('\n')

const SELF_SIGNED_DETAILS = [
  'Executable=/Applications/Edge-Drop.app/Contents/MacOS/Edge-Drop',
  'Identifier=com.edgedrop.app',
  'Signature size=1650',
  'Authority=Edge-Drop Self-Signed',
  'TeamIdentifier=not set'
].join('\n')

const DEVELOPER_ID_DETAILS = [
  'Identifier=com.edgedrop.app',
  'Authority=Developer ID Application: Someone (ABCDE12345)',
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'TeamIdentifier=ABCDE12345'
].join('\n')

const REQUIREMENT = 'identifier "com.edgedrop.app" and certificate leaf = H"0123456789abcdef0123456789abcdef01234567"'

describe('signature of the running app', () => {
  it('tells an ad-hoc signature from a certificate', () => {
    expect(macSignatureKind(ADHOC_DETAILS)).toBe('adhoc')
    expect(macSignatureKind(SELF_SIGNED_DETAILS)).toBe('certificate')
    expect(macSignatureKind(DEVELOPER_ID_DETAILS)).toBe('certificate')
    expect(macSignatureKind('Identifier=com.edgedrop.app\nTeamIdentifier=ABCDE12345')).toBe('certificate')
    expect(macSignatureKind('Identifier=com.edgedrop.app\nTeamIdentifier=not set')).toBeNull()
    expect(macSignatureKind('')).toBeNull()
  })

  it('reads the designated requirement, explicit or implicit', () => {
    expect(parseDesignatedRequirement(`Executable=/x\ndesignated => ${REQUIREMENT}\n`)).toBe(REQUIREMENT)
    expect(parseDesignatedRequirement('Executable=/x\n# designated => cdhash H"d83d"\n')).toBe('cdhash H"d83d"')
    expect(parseDesignatedRequirement('Executable=/x\n')).toBeNull()
  })
})

describe('update signature check', () => {
  const target = '/Applications/Edge-Drop.app'
  const next = '/tmp/edge-drop-update-1/app/Edge-Drop.app'

  function reply(details: string, opts: { requirement?: string | null; mismatch?: boolean; invalid?: boolean } = {}): void {
    exec.calls = []
    exec.reply = (args) => {
      if (args[0] === '-dv') return { stderr: details }
      if (args[0] === '-d' && args[1] === '-r-') {
        return opts.requirement === null ? { stderr: 'Executable=/x' } : { stdout: `designated => ${opts.requirement ?? REQUIREMENT}\n`, stderr: 'Executable=/x' }
      }
      if (args.includes('-R')) return opts.mismatch ? { err: new Error('exit 3'), stderr: 'test-requirement: code failed to satisfy specified code requirement(s)' } : {}
      if (args[0] === '--verify') return opts.invalid ? { err: new Error('exit 1'), stderr: 'invalid signature' } : {}
      return {}
    }
  }

  it('keeps the plain integrity check for an ad-hoc signed app', async () => {
    reply(ADHOC_DETAILS)
    await expect(verifyMacUpdateSignature(target, next)).resolves.toBe('adhoc')
    expect(exec.calls).toEqual([
      ['/usr/bin/codesign', '--verify', '--deep', '--strict', next],
      ['/usr/bin/codesign', '-dv', '--verbose=2', target]
    ])
  })

  it('requires the update to satisfy the designated requirement of a certificate-signed app', async () => {
    reply(SELF_SIGNED_DETAILS)
    await expect(verifyMacUpdateSignature(target, next)).resolves.toBe('certificate')
    expect(exec.calls).toContainEqual(['/usr/bin/codesign', '-d', '-r-', target])
    expect(exec.calls.at(-1)).toEqual(['/usr/bin/codesign', '--verify', '--deep', '--strict', '-R', `=${REQUIREMENT}`, next])
  })

  it('refuses an update signed by someone else', async () => {
    reply(DEVELOPER_ID_DETAILS, { mismatch: true })
    await expect(verifyMacUpdateSignature(target, next)).rejects.toThrow('not signed like the running app')
  })

  it('refuses an update with a broken signature before looking at the running app', async () => {
    reply(SELF_SIGNED_DETAILS, { invalid: true })
    await expect(verifyMacUpdateSignature(target, next)).rejects.toThrow('codesign failed')
    expect(exec.calls).toHaveLength(1)
  })

  it('refuses when the running app has no readable requirement or signature kind', async () => {
    reply(SELF_SIGNED_DETAILS, { requirement: null })
    await expect(verifyMacUpdateSignature(target, next)).rejects.toThrow('no designated requirement')
    reply('Identifier=com.edgedrop.app')
    await expect(verifyMacUpdateSignature(target, next)).rejects.toThrow('cannot read the signature')
  })
})
