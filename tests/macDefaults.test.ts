import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: { getPreferredSystemLanguages: () => ['en-US'] },
  Menu: { buildFromTemplate: vi.fn() }
}))

vi.mock('../electron/store/paths', () => ({
  PATHS: { settingsFile: () => join(mocks.dir, 'settings.json') }
}))

async function loadModule(): Promise<typeof import('../electron/store/settings')> {
  vi.resetModules()
  return import('../electron/store/settings')
}

function writeStored(settings: Record<string, unknown>): void {
  writeFileSync(join(mocks.dir, 'settings.json'), JSON.stringify(settings))
}

function readStored(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(mocks.dir, 'settings.json'), 'utf8')) as Record<string, unknown>
}

beforeEach(() => {
  mocks.dir = mkdtempSync(join(tmpdir(), 'edge-drop-macdefaults-'))
  setPlatform('darwin')
})

afterEach(() => {
  restorePlatform()
  rmSync(mocks.dir, { recursive: true, force: true })
})

afterAll(() => {
  restorePlatform()
})

describe('settings defaults on macOS', () => {
  it('gives a fresh install the mac hotkey, no sounds, the system theme and no launch at login', async () => {
    const { loadSettings } = await loadModule()
    expect(loadSettings()).toMatchObject({
      toggleHotkey: 'Command+Shift+V',
      soundEffects: false,
      theme: 'system',
      launchAtLogin: false,
      macDefaultsVersion: 1
    })
  })

  it('does not create the settings file on a fresh install, so first-run detection keeps working', async () => {
    const { loadSettings } = await loadModule()
    loadSettings()
    expect(existsSync(join(mocks.dir, 'settings.json'))).toBe(false)
  })

  it('persists the applied defaults with the first save', async () => {
    const { saveSettings } = await loadModule()
    saveSettings({ tutorialCompleted: true })
    expect(readStored()).toMatchObject({ toggleHotkey: 'Command+Shift+V', launchAtLogin: false, soundEffects: false, theme: 'system', macDefaultsVersion: 1 })
  })

  it('moves an existing install off the old hotkey and keeps its other choices', async () => {
    writeStored({ toggleHotkey: 'Alt+C', launchAtLogin: true, soundEffects: true, theme: 'dark', tutorialCompleted: true })
    const { loadSettings } = await loadModule()
    expect(loadSettings()).toMatchObject({
      toggleHotkey: 'Command+Shift+V',
      launchAtLogin: true,
      soundEffects: true,
      theme: 'dark',
      macDefaultsVersion: 1
    })
    expect(readStored()).toMatchObject({ toggleHotkey: 'Command+Shift+V', launchAtLogin: true, macDefaultsVersion: 1 })
  })

  it('keeps a hotkey the user picked', async () => {
    writeStored({ toggleHotkey: 'Command+Alt+K', launchAtLogin: true })
    const { loadSettings } = await loadModule()
    expect(loadSettings().toggleHotkey).toBe('Command+Alt+K')
    expect(loadSettings().macDefaultsVersion).toBe(1)
  })

  it('runs once: Alt+C chosen again after the migration stays', async () => {
    writeStored({ toggleHotkey: 'Alt+C', macDefaultsVersion: 1, launchAtLogin: true })
    const { loadSettings } = await loadModule()
    expect(loadSettings().toggleHotkey).toBe('Alt+C')
  })

  it('leaves Windows defaults untouched', async () => {
    setPlatform('win32')
    const { loadSettings } = await loadModule()
    expect(loadSettings()).toMatchObject({ toggleHotkey: 'Alt+C', soundEffects: true, theme: 'dark', launchAtLogin: true })
    expect(loadSettings().macDefaultsVersion).toBeUndefined()

    writeStored({ toggleHotkey: 'Alt+C', launchAtLogin: true })
    const reloaded = await loadModule()
    expect(reloaded.loadSettings().toggleHotkey).toBe('Alt+C')
    expect(readStored().macDefaultsVersion).toBeUndefined()
  })

  it('describes the patch as a pure function', async () => {
    const { macDefaultsPatch } = await loadModule()
    expect(macDefaultsPatch({}, true)).toEqual({ macDefaultsVersion: 1, toggleHotkey: 'Command+Shift+V', soundEffects: false, theme: 'system', launchAtLogin: false })
    expect(macDefaultsPatch({ toggleHotkey: 'Alt+C', theme: 'light' }, false)).toEqual({ macDefaultsVersion: 1, toggleHotkey: 'Command+Shift+V' })
    expect(macDefaultsPatch({ toggleHotkey: 'F5' }, false)).toEqual({ macDefaultsVersion: 1 })
    expect(macDefaultsPatch({ macDefaultsVersion: 1 }, true)).toBeNull()
  })
})

describe('main-process texts on macOS', () => {
  it('resolve the macOS variant of an aliased key', async () => {
    const { mainText } = await import('../electron/main/language')
    const body = mainText('en', 'tray.welcomeBody')
    expect(body).toContain('screen edge')
    expect(body).not.toContain('middle-left')
  })
})
