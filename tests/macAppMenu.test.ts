import { afterEach, describe, expect, it, vi } from 'vitest'
import { restorePlatform, setPlatform } from './helpers/platform'

const mocks = vi.hoisted(() => ({
  language: 'ru',
  setApplicationMenu: vi.fn()
}))

vi.mock('electron', () => ({
  app: { name: 'Edge-Drop', quit: vi.fn(), getPreferredSystemLanguages: () => ['en-US'], getLocale: () => 'en-US' },
  Menu: {
    buildFromTemplate: (template: unknown) => ({ template }),
    setApplicationMenu: mocks.setApplicationMenu
  }
}))
vi.mock('../electron/store/settings', () => ({ loadSettings: () => ({ language: mocks.language }) }))
vi.mock('../electron/main/tray', () => ({ openSettingsFromShell: vi.fn() }))

afterEach(() => {
  restorePlatform()
  mocks.setApplicationMenu.mockReset()
  vi.resetModules()
})

describe('mac app menu labels', () => {
  it.each([
    ['ru', 'Настройки…', 'Завершить Edge-Drop'],
    ['en', 'Settings…', 'Quit Edge-Drop']
  ])('uses the appMenu keys for %s', async (language, settings, quit) => {
    setPlatform('darwin')
    mocks.language = language
    const { installMacAppMenu } = await import('../electron/main/macAppMenu')
    installMacAppMenu()
    const { template } = mocks.setApplicationMenu.mock.calls[0][0] as { template: Array<{ submenu: Array<{ label?: string }> }> }
    expect(template[0].submenu.map((i) => i.label).filter(Boolean)).toEqual([settings, quit])
  })

  it.each([
    ['ru', 'Правка', ['Отменить', 'Повторить', 'Вырезать', 'Копировать', 'Вставить', 'Выбрать все'], 'Окно', ['Закрыть']],
    ['en', 'Edit', ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Select All'], 'Window', ['Close']]
  ])('localizes the Edit and Window menus for %s', async (language, edit, editItems, window, windowItems) => {
    setPlatform('darwin')
    mocks.language = language
    const { installMacAppMenu } = await import('../electron/main/macAppMenu')
    installMacAppMenu()
    const { template } = mocks.setApplicationMenu.mock.calls[0][0] as { template: Array<{ label: string; submenu: Array<{ label?: string; role?: string }> }> }
    expect(template[1].label).toBe(edit)
    expect(template[1].submenu.filter((i) => i.role).map((i) => i.label)).toEqual(editItems)
    expect(template[1].submenu.filter((i) => i.role).map((i) => i.role)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
    expect(template[2].label).toBe(window)
    expect(template[2].submenu.map((i) => i.label)).toEqual(windowItems)
    expect(template[2].submenu.map((i) => i.role)).toEqual(['close'])
  })
})
