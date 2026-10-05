import { Menu, app } from 'electron'
import { loadSettings } from '../store/settings'
import { openSettingsFromShell } from './tray'
import { mainText } from './language'

export function installMacAppMenu(): void {
  if (process.platform !== 'darwin') return
  const language = loadSettings().language
  const text = (key: string): string => mainText(language, key)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          {
            label: text('appMenu.settings'),
            accelerator: 'Command+,',
            click: () => openSettingsFromShell()
          },
          { type: 'separator' },
          {
            label: text('appMenu.quit'),
            accelerator: 'Command+Q',
            click: () => app.quit()
          }
        ]
      },
      {
        label: text('appMenu.edit'),
        submenu: [
          { role: 'undo', label: text('appMenu.undo') },
          { role: 'redo', label: text('appMenu.redo') },
          { type: 'separator' },
          { role: 'cut', label: text('appMenu.cut') },
          { role: 'copy', label: text('menu.copy') },
          { role: 'paste', label: text('appMenu.paste') },
          { role: 'selectAll', label: text('appMenu.selectAll') }
        ]
      },
      {
        label: text('appMenu.window'),
        submenu: [{ role: 'close', label: text('appMenu.close') }]
      }
    ])
  )
}
