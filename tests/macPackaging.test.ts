import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const root = process.cwd()
const require = createRequire(import.meta.url)

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n')
}

const pkg = JSON.parse(read('package.json')) as {
  version: string
  macRevision: number
  scripts: Record<string, string>
  dependencies: Record<string, string>
  build: {
    publish: unknown
    afterPack: unknown
    files: string[]
    asarUnpack: string[]
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
      electronLanguages: string[]
      publish: unknown
      extendInfo: Record<string, unknown>
    }
  }
}
const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { dependencies?: Record<string, string> }> }
const info = pkg.build.mac.extendInfo
const MAC_VERSION_STEP = 'MAC_VERSION=$(node scripts/mac-version.cjs)'
const MAC_VERSION_FLAG = '-c.extraMetadata.version=$MAC_VERSION'

function closure(name: string, seen = new Set<string>()): Set<string> {
  const entry = lock.packages[`node_modules/${name}`]
  if (!entry || seen.has(name)) return seen
  seen.add(name)
  for (const dep of Object.keys(entry.dependencies ?? {})) closure(dep, seen)
  return seen
}

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

  it('declares the edgedrop:// URL scheme', () => {
    expect(info.CFBundleURLTypes).toEqual([{ CFBundleURLName: 'com.edgedrop.app', CFBundleURLSchemes: ['edgedrop'] }])
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
    expect(mac.files).toContain('!**/node_modules/@koromix/koffi-!(darwin-${arch})/**')
    expect(mac.files).toContain('!**/node_modules/@resvg/resvg-js-!(darwin-${arch})/**')
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
    expect(release.match(/secrets\.[A-Z0-9_]+/g)).toEqual(['secrets.MAC_SIGN_P12_BASE64', 'secrets.MAC_SIGN_P12_PASSWORD', 'secrets.GITHUB_TOKEN'])
    expect(release).not.toMatch(/CSC_LINK|CSC_KEY_PASSWORD|APPLE_ID|APPLE_API_KEY|--win|nsis|appx/)
  })

  it('publishes SHA256SUMS.txt for the in-app updater next to the artifacts', () => {
    const count = release.indexOf('Expected 4 artifacts')
    const sums = release.indexOf('(cd artifacts && sha256sum -- *.dmg *.zip > SHA256SUMS.txt)')
    const added = release.indexOf('files+=(artifacts/SHA256SUMS.txt)')
    const upload = release.indexOf('gh release view')
    expect(count).toBeGreaterThan(-1)
    expect(count).toBeLessThan(sums)
    expect(sums).toBeLessThan(added)
    expect(added).toBeLessThan(upload)
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
    expect(links).toContain("export const REPO_URL = IS_DARWIN ? 'https://github.com/SVorobiev-ru/Edge-Drop' : 'https://github.com/Deepender25/Edge-Drop'")
    expect(links).toContain("export const CHANGELOG_URL = IS_DARWIN ? `${REPO_URL}/releases` : 'https://www.edgedrop.app/changelog'")
    expect(src).toContain("import { REPO_URL, CHANGELOG_URL, SUPPORT_URL } from '../lib/links'")
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

  it('offers download and install with the release page as the secondary action', () => {
    const promoted = src.slice(src.indexOf('const renderPromotedUpdateCard'), src.indexOf('const renderManualUpdateCard'))
    expect(promoted).toContain("{t('behaviour.installUpdate')}")
    expect(promoted).toContain("{t('behaviour.openReleasePage')}")
    expect(promoted).toContain('onClick={handleOpenChangelog}')
  })

  it('downloads through the shared update flow', () => {
    expect(src).toMatch(/const handleStartDownload = \(\) => \{\s*void useStore\.getState\(\)\.startManualDownload\(\)\s*\}/)
    expect(src).toContain('const shownUpdateMode = displayedUpdateMode(updateMode, IS_DARWIN)')
  })

  it('main process starts the release check on every platform', () => {
    const index = read('electron/main/index.ts')
    expect(index).toMatch(/^\s*initAutoUpdater\(\)$/m)
    expect(index).toContain('installMacAppMenu()')
  })
})

describe('mac app.asar contents', () => {
  const mac = pkg.build.mac

  it('repeats the top-level whitelist, because a mac files list replaces it', () => {
    expect(mac.files.slice(0, pkg.build.files.length)).toEqual(pkg.build.files)
    expect(mac.files.some((p) => !p.startsWith('!'))).toBe(true)
  })

  it('adds only exclusions after the whitelist', () => {
    for (const pattern of mac.files.slice(pkg.build.files.length)) expect(pattern.startsWith('!')).toBe(true)
  })

  it('leaves electron-updater and everything only it needs out of the mac build', () => {
    const updater = closure('electron-updater')
    const others = new Set<string>()
    for (const name of Object.keys(pkg.dependencies)) {
      if (name !== 'electron-updater') closure(name, others)
    }
    for (const name of updater) {
      const excluded = mac.files.includes(`!**/node_modules/${name}/**`)
      expect(excluded, name).toBe(!others.has(name))
    }
  })

  it('does not exclude the runtime dependencies the mac build needs', () => {
    for (const name of ['koffi', '@resvg/resvg-js', 'react', 'zustand']) {
      expect(mac.files).not.toContain(`!**/node_modules/${name}/**`)
    }
  })

  it('leaves the top-level files list and the Windows sections alone', () => {
    expect(pkg.build.files).not.toContain('!**/node_modules/electron-updater/**')
    expect('files' in pkg.build.win).toBe(false)
    expect('files' in pkg.build.nsis).toBe(false)
    expect('files' in pkg.build.appx).toBe(false)
    expect('electronLanguages' in pkg.build.win).toBe(false)
  })
})

describe('Electron languages on macOS', () => {
  const languages = pkg.build.mac.electronLanguages
  const translations = readdirSync(join(root, 'edge-drop-translations'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))

  const toLproj: Record<string, string[]> = {
    no: ['nb'],
    pt: ['pt_BR', 'pt_PT'],
    'zh-CN': ['zh_CN'],
    'zh-TW': ['zh_TW']
  }

  it('keeps one Electron locale for every UI translation', () => {
    for (const code of translations) {
      for (const lproj of toLproj[code] ?? [code]) expect(languages, code).toContain(lproj)
    }
  })

  it('keeps nothing else', () => {
    const expected = translations.flatMap((code) => toLproj[code] ?? [code])
    expect([...languages].sort()).toEqual([...expected].sort())
  })

  it('uses the lproj names of Electron Framework', () => {
    for (const language of languages) expect(language).toMatch(/^[a-z]{2,3}(_[A-Z0-9]{2,3})?$/)
  })
})

describe('production CSP', () => {
  const { stripDevCsp } = require('../scripts/strip-dev-csp.cjs') as { stripDevCsp: (html: string) => string }
  const html = read('index.html')

  it('the source page keeps ws: for the dev server', () => {
    expect(html).toMatch(/connect-src 'self' ws:/)
  })

  it('the build step drops ws: and leaves the rest of the policy as is', () => {
    const out = stripDevCsp(html)
    expect(out).toContain("connect-src 'self';")
    expect(out).not.toMatch(/\bwss?:/)
    expect(out.replace("connect-src 'self';", "connect-src 'self' ws:;")).toBe(html)
  })

  it('also drops wss: and keeps other sources of connect-src', () => {
    const page = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\' ws: wss: https://api.github.com; img-src \'self\'" />'
    expect(stripDevCsp(page)).toBe('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\' https://api.github.com; img-src \'self\'" />')
  })

  it('allows data urls for images in the renderer policy', () => {
    expect(html).toMatch(/img-src 'self' data:/)
  })

  it('runs after every electron-vite build, so all targets get it', () => {
    expect(pkg.scripts.build).toBe('electron-vite build && node scripts/strip-dev-csp.cjs')
    expect(pkg.scripts.dev).toBe('electron-vite dev')
    for (const name of ['build:github', 'build:store', 'build:mac', 'dist:mac', 'dist:mac:arm64', 'dist:mac:x64']) {
      expect(pkg.scripts[name].startsWith('npm run build && '), name).toBe(true)
    }
  })
})

describe('app.asar allow-list check', () => {
  const { checkAsarEntries, topLevelEntries, ALLOWED_TOP_LEVEL } = require('../scripts/check-mac-asar.cjs') as {
    checkAsarEntries: (files: string[]) => string[]
    topLevelEntries: (files: string[]) => string[]
    ALLOWED_TOP_LEVEL: string[]
  }

  const good = [
    '/package.json',
    '/out',
    '/out/main/index.js',
    '/resources',
    '/resources/icon.png',
    '/node_modules',
    '/node_modules/koffi/index.js'
  ]

  it('allows only the app output, its resources, package.json and node_modules', () => {
    expect(ALLOWED_TOP_LEVEL).toEqual(['node_modules', 'out', 'package.json', 'resources'])
    expect(topLevelEntries(good)).toEqual(['node_modules', 'out', 'package.json', 'resources'])
    expect(checkAsarEntries(good)).toEqual([])
  })

  it.each(['/src/main.tsx', '/tests/a.test.ts', '/scratch/x', '/new icons/a.png', '/README.md', '/.claude/settings.json', '/edge-drop-translations/en.json'])(
    'fails on %s',
    (extra) => {
      expect(checkAsarEntries([...good, extra]).length).toBeGreaterThan(0)
    }
  )

  it('fails when electron-updater slipped in', () => {
    expect(checkAsarEntries([...good, '/node_modules/electron-updater/out/main.js'])).toEqual([
      'module must not be packed on macOS: electron-updater'
    ])
  })

  it('fails when the app itself is missing', () => {
    expect(checkAsarEntries(['/node_modules/koffi/index.js'])).toEqual([
      'missing top-level entry: out',
      'missing top-level entry: package.json',
      'missing top-level entry: resources'
    ])
  })

  it('verify-mac-dist.sh runs the check on the DMG and the ZIP', () => {
    const verify = read('scripts/verify-mac-dist.sh')
    expect(verify).toContain('node scripts/check-mac-asar.cjs "$app" || fail')
    expect(verify.indexOf('check-mac-asar')).toBeLessThan(verify.indexOf('check_app "${MOUNT}'))
  })
})

describe('signing hook', () => {
  const childProcess = require('node:child_process') as typeof import('node:child_process')
  const hookPath = require.resolve('../scripts/mac-adhoc-sign.cjs')
  const app = join(root, 'dist', 'mac-arm64', 'Edge-Drop.app')
  const context = { electronPlatformName: 'darwin', appOutDir: join(root, 'dist', 'mac-arm64'), packager: { appInfo: { productFilename: 'Edge-Drop' } } }
  let codesign: ReturnType<typeof vi.fn>
  let hook: (context: unknown) => Promise<void>
  const saved = process.env.EDGE_DROP_SIGN_IDENTITY

  beforeEach(() => {
    codesign = vi.fn()
    vi.spyOn(childProcess, 'execFileSync').mockImplementation(((...args: unknown[]) => codesign(...args)) as never)
    delete require.cache[hookPath]
    hook = require(hookPath) as (context: unknown) => Promise<void>
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete require.cache[hookPath]
    if (saved === undefined) delete process.env.EDGE_DROP_SIGN_IDENTITY
    else process.env.EDGE_DROP_SIGN_IDENTITY = saved
  })

  it('signs with the identity from EDGE_DROP_SIGN_IDENTITY', async () => {
    process.env.EDGE_DROP_SIGN_IDENTITY = 'Edge-Drop Self-Signed'
    await hook(context)
    expect(codesign.mock.calls[0]).toEqual(['codesign', ['--force', '--deep', '-s', 'Edge-Drop Self-Signed', app], { stdio: 'inherit' }])
    expect(codesign.mock.calls[1][1]).toEqual(['--verify', '--deep', '--strict', app])
  })

  it('signs with a SHA-1 identity hash as well', async () => {
    process.env.EDGE_DROP_SIGN_IDENTITY = ' 0123456789ABCDEF0123456789ABCDEF01234567 '
    await hook(context)
    expect(codesign.mock.calls[0][1]).toEqual(['--force', '--deep', '-s', '0123456789ABCDEF0123456789ABCDEF01234567', app])
  })

  it('falls back to ad-hoc when the variable is empty or unset', async () => {
    process.env.EDGE_DROP_SIGN_IDENTITY = '  '
    await hook(context)
    delete process.env.EDGE_DROP_SIGN_IDENTITY
    await hook(context)
    expect(codesign.mock.calls.filter((c) => c[1][0] === '--force').map((c) => c[1][3])).toEqual(['-', '-'])
  })
})

describe('release signing in CI', () => {
  const release = read('.github/workflows/release-mac.yml')
  const importer = read('scripts/ci-import-signing-cert.sh')

  it('imports the certificate before the build and deletes the keychain afterwards', () => {
    const importStep = release.indexOf('run: bash scripts/ci-import-signing-cert.sh\n')
    const build = release.indexOf('run: npm run dist:mac:${{ matrix.arch }}')
    const verify = release.indexOf('run: bash scripts/verify-mac-dist.sh ${{ matrix.arch }}')
    const cleanup = release.indexOf('run: bash scripts/ci-import-signing-cert.sh cleanup')
    expect(importStep).toBeGreaterThan(-1)
    expect(importStep).toBeLessThan(build)
    expect(build).toBeLessThan(verify)
    expect(verify).toBeLessThan(cleanup)
    expect(release).toMatch(/- name: Remove the signing keychain\n\s+if: always\(\)/)
  })

  it('passes the secrets only to the import step', () => {
    expect(release).toMatch(/MAC_SIGN_P12_BASE64: \$\{\{ secrets\.MAC_SIGN_P12_BASE64 \}\}\n\s+MAC_SIGN_P12_PASSWORD: \$\{\{ secrets\.MAC_SIGN_P12_PASSWORD \}\}\n\s+run: bash scripts\/ci-import-signing-cert\.sh\n/)
  })

  it('stays ad-hoc without the secrets', () => {
    expect(importer).toMatch(/if \[\[ -z "\$\{MAC_SIGN_P12_BASE64:-\}" \|\| -z "\$\{MAC_SIGN_P12_PASSWORD:-\}" \]\]; then\n\s+echo "Signing secrets are not set: the build is signed ad-hoc"\n\s+exit 0/)
  })

  it('hands the identity to later steps and keeps codesign able to find it', () => {
    expect(importer).toContain('>> "${GITHUB_ENV:?GITHUB_ENV is not set}"')
    expect(importer).toContain('EDGE_DROP_SIGN_IDENTITY=${IDENTITY}')
    expect(importer).toContain('EDGE_DROP_SIGN_NAME=${IDENTITY_NAME}')
    expect(importer).toContain("trap 'rm -f \"$P12\"' EXIT")
    expect(importer).toContain('security set-key-partition-list -S apple-tool:,apple:,codesign:')
    expect(importer).toContain('security list-keychains -d user -s "$KEYCHAIN"')
    expect(importer).toContain('rm -f "$P12"')
  })

  it('verify-mac-dist.sh checks the certificate signature when an identity is set', () => {
    const verify = read('scripts/verify-mac-dist.sh')
    expect(verify).toContain('SIGN_IDENTITY="${EDGE_DROP_SIGN_NAME:-${EDGE_DROP_SIGN_IDENTITY:-}}"')
    expect(verify).toContain('grep -qxF "Authority=${SIGN_IDENTITY}"')
    expect(verify).toContain("grep -q '^Signature=adhoc$' || fail \"signature is not ad-hoc\"")
  })

  it('the certificate script makes a 10 year code-signing certificate and only prints the gh commands', () => {
    const script = read('scripts/make-signing-cert.sh')
    expect(script).toContain('DAYS=3650')
    expect(script).toContain('extendedKeyUsage = critical, codeSigning')
    expect(script).toContain('echo "  gh secret set MAC_SIGN_P12_BASE64 --repo ${REPO} < \\"${B64_FILE}\\""')
    expect(script).toContain('echo "  gh secret set MAC_SIGN_P12_PASSWORD --repo ${REPO} < \\"${PASS_FILE}\\""')
    expect(script.split('\n').filter((line) => /^\s*gh /.test(line))).toEqual([])
  })
})

describe('CI build of the mac app', () => {
  const ci = read('.github/workflows/ci.yml')

  it('builds, checks the asar and smoke-tests the binary on macOS only', () => {
    const steps = ['run: npm run build:mac', 'arm64) dir=dist/mac-arm64 ;;', 'run: node scripts/check-mac-asar.cjs "$MAC_APP"', 'run: bash scripts/smoke-test-mac.sh "$MAC_APP"']
    let last = ci.indexOf('run: npm run typecheck')
    for (const step of steps) {
      const at = ci.indexOf(step)
      expect(at, step).toBeGreaterThan(last)
      expect(ci.slice(ci.lastIndexOf('- name:', at), at)).toContain("if: runner.os == 'macOS'")
      last = at
    }
  })

  it('derives the app folder from the runner architecture', () => {
    expect(ci).toContain('*) dir=dist/mac ;;')
    expect(ci).toContain('echo "MAC_APP=${dir}/Edge-Drop.app" >> "$GITHUB_ENV"')
  })

  it('the smoke script fails on a non-zero exit or a bad JSON line', () => {
    const script = read('scripts/smoke-test-mac.sh')
    expect(script).toContain('"$BIN" --smoke-test')
    expect(script).toContain('FAIL: smoke test exited with')
    expect(script).toContain('result.smokeTest !== true || result.ok !== true')
  })
})

describe('Homebrew cask', () => {
  const cask = read('packaging/homebrew/edge-drop.rb')

  it('points at both architectures of the fork releases', () => {
    expect(cask).toContain('arch arm: "arm64", intel: "x64"')
    expect(cask).toContain('url "https://github.com/SVorobiev-ru/Edge-Drop/releases/download/v#{version}/Edge-Drop-#{version}-mac-#{arch}.dmg"')
    expect(cask).toMatch(/sha256 arm:\s+"[^"]+",\n\s+intel: "[^"]+"/)
    expect(cask).toContain('app "Edge-Drop.app"')
  })

  it('requires the same minimum macOS as Info.plist', () => {
    expect(cask).toContain('depends_on macos: ">= :monterey"')
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.build.mac.minimumSystemVersion).toBe('12.0')
  })

  it('update-cask.sh fills version and both checksums', () => {
    const script = read('scripts/update-cask.sh')
    expect(script).toContain('https://github.com/${REPO}/releases/download/v${VERSION}/${name}')
    expect(script).toContain('die "cask layout not recognized\\n" unless $n == 3;')
  })
})

describe('macOS documentation of signing and Homebrew', () => {
  const doc = read('MACOS.md')
  const readme = read('README.md')

  it('documents the stable signature and that quarantine stays', () => {
    for (const text of ['make-signing-cert.sh', 'MAC_SIGN_P12_BASE64', 'MAC_SIGN_P12_PASSWORD', 'Gatekeeper still quarantines the first install', 'packaging/homebrew/edge-drop.rb', 'update-cask.sh']) {
      expect(doc).toContain(text)
    }
  })

  it('README points mac users at the fork releases before the Windows content', () => {
    const fork = readme.indexOf('https://github.com/SVorobiev-ru/Edge-Drop/releases/latest')
    expect(fork).toBeGreaterThan(-1)
    expect(fork).toBeLessThan(readme.indexOf('## Quick Start'))
    expect(fork).toBeLessThan(readme.indexOf('img.shields.io/github/v/release/Deepender25'))
    expect(readme).toContain('https://apps.microsoft.com/detail/9P3JMHN9M4NR')
  })
})
