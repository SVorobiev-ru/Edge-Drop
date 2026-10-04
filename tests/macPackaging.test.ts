import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const root = process.cwd()

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

const pkg = JSON.parse(read('package.json')) as {
  version: string
  macRevision: number
  scripts: Record<string, string>
  build: {
    publish: unknown
    afterPack: unknown
    win: Record<string, unknown>
    nsis: Record<string, unknown>
    appx: Record<string, unknown>
    mac: {
      target: unknown
      artifactName: string
      identity: unknown
      hardenedRuntime: unknown
      notarize: unknown
      files: string[]
      publish: unknown
      extendInfo: Record<string, unknown>
    }
  }
}
const info = pkg.build.mac.extendInfo
const MAC_VERSION_STEP = 'MAC_VERSION=$(node scripts/mac-version.cjs)'
const MAC_VERSION_FLAG = '-c.extraMetadata.version=$MAC_VERSION'

describe('macOS Info.plist configuration', () => {
  it('stays a menu bar app', () => {
    expect(info.LSUIElement).toBe(true)
  })

  it('describes Apple Events and folder access in English', () => {
    for (const key of [
      'NSAppleEventsUsageDescription',
      'NSDesktopFolderUsageDescription',
      'NSDocumentsFolderUsageDescription',
      'NSDownloadsFolderUsageDescription'
    ]) {
      expect(typeof info[key]).toBe('string')
      expect(info[key]).toMatch(/^Edge-Drop [\x20-\x7e]+\.$/)
    }
    expect(info.NSAppleEventsUsageDescription).toContain('System Events')
  })

  it('drops the default camera, microphone and Bluetooth descriptions', () => {
    for (const key of [
      'NSCameraUsageDescription',
      'NSMicrophoneUsageDescription',
      'NSBluetoothAlwaysUsageDescription',
      'NSBluetoothPeripheralUsageDescription'
    ]) {
      expect(key in info).toBe(true)
      expect(info[key]).toBeNull()
    }
  })

})

describe('macOS distribution build', () => {
  const mac = pkg.build.mac

  it('builds a DMG and a ZIP per architecture, not a universal binary', () => {
    expect(mac.target).toEqual([
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ])
    expect(mac.artifactName).toBe('Edge-Drop-${version}-mac-${arch}.${ext}')
  })

  it('leaves signing to the afterPack hook, without hardened runtime and never notarizes', () => {
    expect(mac.identity).toBeNull()
    expect(pkg.build.afterPack).toBe('./scripts/mac-adhoc-sign.cjs')
    expect('afterPack' in mac).toBe(false)
    expect('afterPack' in pkg.build.win).toBe(false)
    expect(mac.hardenedRuntime).toBe(false)
    expect(mac.notarize).toBe(false)
    expect('entitlements' in mac).toBe(false)
  })

  describe('afterPack hook', () => {
    const require = createRequire(import.meta.url)
    const childProcess = require('node:child_process') as typeof import('node:child_process')
    const hookPath = require.resolve('../scripts/mac-adhoc-sign.cjs')
    const appOutDir = join(root, 'dist', 'mac-arm64')
    const app = join(appOutDir, 'Edge-Drop.app')
    const context = (electronPlatformName: string) => ({
      electronPlatformName,
      appOutDir,
      packager: { appInfo: { productFilename: 'Edge-Drop' } }
    })
    let codesign: ReturnType<typeof vi.fn>
    let hook: (context: unknown) => Promise<void>

    beforeEach(() => {
      codesign = vi.fn()
      vi.spyOn(childProcess, 'execFileSync').mockImplementation(((...args: unknown[]) => codesign(...args)) as never)
      delete require.cache[hookPath]
      hook = require(hookPath) as (context: unknown) => Promise<void>
    })

    afterEach(() => {
      vi.restoreAllMocks()
      delete require.cache[hookPath]
    })

    it('returns at once for a Windows build', async () => {
      await expect(hook(context('win32'))).resolves.toBeUndefined()
      expect(codesign).not.toHaveBeenCalled()
    })

    it('signs ad-hoc and then verifies the result', async () => {
      await expect(hook(context('darwin'))).resolves.toBeUndefined()
      expect(codesign.mock.calls).toEqual([
        ['codesign', ['--force', '--deep', '-s', '-', app], { stdio: 'inherit' }],
        ['codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' }]
      ])
    })

    it('fails the build when the bundle cannot be signed', async () => {
      codesign.mockImplementation(() => {
        throw new Error('codesign failed')
      })
      await expect(hook(context('darwin'))).rejects.toThrow('codesign failed')
      expect(codesign).toHaveBeenCalledTimes(1)
    })

    it('fails the build when the signature does not verify', async () => {
      codesign.mockImplementation((_cmd: string, args: string[]) => {
        if (args.includes('--verify')) throw new Error('invalid signature')
      })
      await expect(hook(context('darwin'))).rejects.toThrow('invalid signature')
      expect(codesign).toHaveBeenCalledTimes(2)
    })

    it('install-mac.sh still signs the bundle itself', () => {
      expect(read('scripts/install-mac.sh')).toContain('codesign --force --deep -s "${EDGE_DROP_SIGN_IDENTITY:--}" "$APP"')
    })
  })

  it('packs only the native binaries of the target architecture', () => {
    expect(mac.files).toEqual([
      '!**/node_modules/@koromix/koffi-!(darwin-${arch})/**',
      '!**/node_modules/@resvg/resvg-js-!(darwin-${arch})/**'
    ])
  })

  it('publishes mac builds to the fork and leaves the Windows source alone', () => {
    expect(mac.publish).toEqual({ provider: 'github', owner: 'SVorobiev-ru', repo: 'Edge-Drop' })
    expect(pkg.build.publish).toEqual({ provider: 'github', owner: 'Deepender25', repo: 'Edge-Drop' })
    expect('publish' in pkg.build.win).toBe(false)
    expect('publish' in pkg.build.nsis).toBe(false)
    expect('publish' in pkg.build.appx).toBe(false)
  })

  it('keeps build:mac a quick unpacked build for install-mac.sh', () => {
    expect(pkg.scripts['build:mac']).toBe(`npm run build && ${MAC_VERSION_STEP} && electron-builder --mac dir --publish never ${MAC_VERSION_FLAG}`)
    expect(pkg.scripts['install:mac']).toBe('bash scripts/install-mac.sh')
    const install = read('scripts/install-mac.sh')
    expect(install).toContain('npm run build:mac')
    expect(install).toContain('dist/mac-arm64')
    expect(install).toContain('"dist/mac"')
  })

  it.each([
    ['dist:mac', ['arm64', 'x64']],
    ['dist:mac:arm64', ['arm64']],
    ['dist:mac:x64', ['x64']]
  ])('%s builds dmg and zip for %j without publishing', (name, archs) => {
    const script = pkg.scripts[name]
    expect(script).toContain('npm run build && ')
    expect(script).toContain(`node scripts/check-mac-native.cjs ${archs.join(' ')} && `)
    expect(script).toContain(`${MAC_VERSION_STEP} && electron-builder --mac dmg zip `)
    expect(script.endsWith(` --publish never ${MAC_VERSION_FLAG}`)).toBe(true)
    for (const arch of ['arm64', 'x64']) {
      expect(script.includes(`--${arch}`)).toBe(archs.includes(arch))
    }
  })

  it('does not publish from any mac script', () => {
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (!script.includes('--mac')) continue
      expect(script, name).toContain('--publish never')
    }
  })

  it('ships the helper scripts', () => {
    expect(existsSync(join(root, 'scripts/mac-version.cjs'))).toBe(true)
    expect(existsSync(join(root, 'scripts/check-mac-native.cjs'))).toBe(true)
    expect(existsSync(join(root, 'scripts/verify-mac-dist.sh'))).toBe(true)
    expect(existsSync(join(root, 'scripts/mac-adhoc-sign.cjs'))).toBe(true)
  })
})

describe('fork version', () => {
  const macVersion = () => execFileSync(process.execPath, [join(root, 'scripts/mac-version.cjs')], { encoding: 'utf8' }).trim()

  it('keeps the upstream version in package.json and the port revision next to it', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(Number.isInteger(pkg.macRevision)).toBe(true)
    expect(pkg.macRevision).toBeGreaterThanOrEqual(1)
  })

  it('matches the lock file', () => {
    const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: Record<string, { version: string }> }
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
  })

  it('mac-version.cjs prints <upstream version>-mac.<macRevision>', () => {
    expect(macVersion()).toBe(`${pkg.version}-mac.${pkg.macRevision}`)
    expect(macVersion()).toMatch(/^\d+\.\d+\.\d+-mac\.[1-9]\d*$/)
  })

  it('only the mac scripts override the version', () => {
    for (const [name, script] of Object.entries(pkg.scripts)) {
      expect(script.includes('extraMetadata.version'), name).toBe(script.includes('electron-builder --mac'))
      if (script.includes('--win')) expect(script, name).not.toContain('mac-version')
    }
  })

  it('the release tag and the artifact check use the mac version', () => {
    const release = read('.github/workflows/release-mac.yml')
    expect(release).toContain('version="$(node scripts/mac-version.cjs)"')
    expect(release).not.toContain("require('./package.json').version")
    const verify = read('scripts/verify-mac-dist.sh')
    expect(verify).toContain('VERSION="$(node scripts/mac-version.cjs)"')
    expect(verify).toContain('DMG="dist/${APP_NAME}-${VERSION}-mac-${ARCH}.dmg"')
    expect(verify).toContain('fail "CFBundleShortVersionString is ${version}, expected ${VERSION}"')
  })
})

describe('GitHub workflows', () => {
  const ci = read('.github/workflows/ci.yml').replace(/\r\n/g, '\n')
  const release = read('.github/workflows/release-mac.yml').replace(/\r\n/g, '\n')

  it('CI tests and typechecks on macOS and Windows', () => {
    expect(ci).toMatch(/^on:\n  push:\n    branches:\n      - main\n      - macos-port\n  pull_request:$/m)
    expect(ci).not.toContain('tags:')
    expect(ci).toMatch(/^concurrency:\n  group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: true$/m)
    expect(ci).toMatch(/^    timeout-minutes: \d+$/m)
    expect(ci).toContain('- macos-latest')
    expect(ci).toContain('- windows-latest')
    expect(ci).toContain('run: npm ci')
    expect(ci).toContain('run: npx vitest run')
    expect(ci).toContain('run: npm run typecheck')
    expect(ci).not.toContain('contents: write')
  })

  it('the mac release runs only for fork tags in the fork repository', () => {
    expect(release).toMatch(/^on:\n  push:\n    tags:\n      - 'v\*-mac\.\*'\n\npermissions:$/m)
    expect(release).not.toContain('branches:')
    expect(release).not.toContain('pull_request')
    expect(release.split("if: github.repository == 'SVorobiev-ru/Edge-Drop'")).toHaveLength(3)
  })

  it('builds each architecture on a matching runner and verifies it', () => {
    expect(release).toMatch(/- arch: arm64\n\s+runner: macos-latest/)
    expect(release).toMatch(/- arch: x64\n\s+runner: macos-15-intel/)
    expect(release).toContain('run: npm run dist:mac:${{ matrix.arch }}')
    expect(release).toContain('run: bash scripts/verify-mac-dist.sh ${{ matrix.arch }}')
  })

  it('publishes a regular latest release with the install notes and only the default token', () => {
    expect(release).toContain('gh release create')
    expect(release).toMatch(/if gh release view "\$\{GITHUB_REF_NAME\}" --repo "\$\{GITHUB_REPOSITORY\}" >\/dev\/null 2>&1; then\n\s+gh release upload "\$\{GITHUB_REF_NAME\}" "\$\{files\[@\]\}" \\\n\s+--repo "\$\{GITHUB_REPOSITORY\}" \\\n\s+--clobber\n\s+else\n\s+gh release create/)
    expect(release.match(/^    timeout-minutes: \d+$/gm)).toHaveLength(2)
    expect(release).toContain('--notes-file .github/release-notes-mac.md')
    expect(release).toContain('--prerelease=false')
    expect(release).toContain('--latest')
    expect(release.split('contents: write')).toHaveLength(2)
    expect(release.match(/secrets\.[A-Z_]+/g)).toEqual(['secrets.GITHUB_TOKEN'])
    expect(release).not.toMatch(/CSC_LINK|CSC_KEY_PASSWORD|APPLE_ID|APPLE_API_KEY|--win|nsis|appx/)
  })

  it('pins actions by major version', () => {
    for (const src of [ci, release]) {
      const uses = src.match(/uses: \S+/g) ?? []
      expect(uses.length).toBeGreaterThan(0)
      for (const line of uses) expect(line).toMatch(/^uses: actions\/[a-z-]+@v\d+$/)
    }
  })

  it('release notes explain the unsigned install', () => {
    const notes = read('.github/release-notes-mac.md')
    expect(notes).toContain('xattr -dr com.apple.quarantine /Applications/Edge-Drop.app')
    expect(notes).not.toContain('xattr -cr')
    expect(notes).toContain('tccutil reset Accessibility com.edgedrop.app\ntccutil reset PostEvent com.edgedrop.app')
    expect(notes).toContain('Privacy & Security → Accessibility')
    expect(notes).toContain('Open Anyway')
    expect(notes).toContain('Deepender25/Edge-Drop')
  })
})

describe('macOS documentation', () => {
  it('MACOS.md is in English and covers install, permissions and updates', () => {
    const doc = read('MACOS.md')
    expect(doc).not.toMatch(/[\u0400-\u04ff]/)
    expect(doc).not.toContain('xattr -cr')
    for (const text of [
      'xattr -dr com.apple.quarantine /Applications/Edge-Drop.app',
      'Open Anyway',
      'tccutil reset Accessibility com.edgedrop.app\ntccutil reset PostEvent com.edgedrop.app',
      'After the reset, turn Edge-Drop on again in **System Settings → Privacy & Security → Accessibility**',
      'may appear on the first launch, because the app watches the screenshot folder',
      'npm run install:mac',
      '--no-build',
      '--no-launch',
      'EDGE_DROP_SIGN_IDENTITY',
      'https://github.com/SVorobiev-ru/Edge-Drop/releases',
      'Deepender25/Edge-Drop'
    ]) {
      expect(doc).toContain(text)
    }
  })

  it('line endings are normalized to LF on every platform', () => {
    expect(read('.gitattributes')).toBe('* text=auto eol=lf\n')
  })

  it('README links the fork releases and MACOS.md without dropping the original links', () => {
    const readme = read('README.md')
    expect(readme).toContain('## macOS')
    expect(readme).toContain('https://github.com/SVorobiev-ru/Edge-Drop/releases/latest')
    expect(readme).toContain('[MACOS.md](MACOS.md)')
    expect(readme).toContain('https://github.com/Deepender25/Edge-Drop/releases/latest')
  })
})

describe('Settings links', () => {
  const src = read('src/components/Settings.tsx')
  const links = read('src/lib/links.ts')
  const header = read('src/components/Header.tsx')

  it('point at the fork on macOS and at the original elsewhere', () => {
    expect(links).toContain("export const REPO_URL = IS_MAC ? 'https://github.com/SVorobiev-ru/Edge-Drop' : 'https://github.com/Deepender25/Edge-Drop'")
    expect(links).toContain("export const CHANGELOG_URL = IS_MAC ? `${REPO_URL}/releases` : 'https://www.edgedrop.app/changelog'")
    expect(src).toContain("import { REPO_URL, CHANGELOG_URL } from '../lib/links'")
    expect(src).not.toMatch(/const (REPO_URL|CHANGELOG_URL) =/)
    expect(src.split("window.open(`${REPO_URL}/issues/new/choose`, '_blank')")).toHaveLength(3)
    expect(src.split("window.open(REPO_URL, '_blank')")).toHaveLength(3)
    expect(src.split("window.open(CHANGELOG_URL, '_blank')")).toHaveLength(4)
    expect(src).not.toMatch(/window\.open\('https:\/\/github\.com/)
    expect(src).not.toContain("window.open('https://www.edgedrop.app/changelog'")
  })

  it('the header What\'s New button uses the same changelog link', () => {
    expect(header).toContain("import { CHANGELOG_URL } from '../lib/links'")
    expect(header).toContain("window.open(CHANGELOG_URL, '_blank')")
    expect(header).not.toContain('edgedrop.app/changelog')
  })

  it('explains which screenshots the capture setting covers', async () => {
    const { en, ru } = await import('../src/i18n/translations')
    for (const dict of [en, ru]) {
      const desc = dict.behaviour.captureScreenshotsDesc ?? ''
      for (const keys of ['⌘⇧3', '⌘⇧4', '⌘⇧5', '⌃⌘⇧3', '⌃⌘⇧4']) expect(desc).toContain(keys)
    }
    expect(en.behaviour.captureScreenshotsDesc).toMatch(/saved to a file/)
    expect(ru.behaviour.captureScreenshotsDesc).toMatch(/сохранённые в файл/)
  })
})

describe('macOS update block in Settings', () => {
  const src = read('src/components/Settings.tsx')

  it('labels the action as opening the release page', () => {
    expect(src.split("IS_MAC ? t('behaviour.openReleasePage') : (t('behaviour.update') || 'Update')")).toHaveLength(3)
  })

  it('never enters the downloading state', () => {
    expect(src).toContain('const isDownloading = !IS_MAC && (')
    expect(src).toMatch(/if \(IS_MAC\) \{\s*void window\.edge\.startUpdateDownload\(\)\s*return\s*\}/)
  })

  it('main process starts the release check on every platform', () => {
    const index = read('electron/main/index.ts')
    expect(index).toMatch(/^\s*initAutoUpdater\(\)$/m)
    expect(index).toContain('installMacAppMenu()')
  })
})
