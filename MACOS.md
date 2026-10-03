# Edge-Drop для macOS

Форк [Deepender25/Edge-Drop](https://github.com/Deepender25/Edge-Drop) (Windows, Electron), перенесённый на Mac. Дизайн и функции — как в оригинале.

## Сборка и установка

```bash
npm install
npm run build:mac                      # → dist/mac-arm64/Edge-Drop.app
codesign --force --deep -s - dist/mac-arm64/Edge-Drop.app
rm -rf /Applications/Edge-Drop.app && cp -R dist/mac-arm64/Edge-Drop.app /Applications/
xattr -cr /Applications/Edge-Drop.app && open /Applications/Edge-Drop.app
```

Разработка: `npm run build && npx electron .` (в dev-режиме в лог пишется `[Capture] <тип>` на каждое копирование).

## Что сделано под Mac

| Что | Как на Windows | Как на Mac |
|---|---|---|
| Отслеживание буфера | GetClipboardSequenceNumber | `NSPasteboard.changeCount` через koffi (`electron/clipboard/formats.ts`) |
| Файлы из Finder | FileNameW / PowerShell | `NSFilenamesPboardType` / `public.file-url` |
| Файлы в буфер | PowerShell SetFileDropList | JXA `NSPasteboard.writeObjects` (`electron/main/ipc.ts`) |
| Вставка | SendKeys Ctrl+V | `osascript` ⌘V (нужен «Универсальный доступ») |
| Фокус после поиска | Get/SetForegroundWindow | `NSWorkspace.frontmostApplication` + `activateWithOptions` (`electron/main/macNative.ts`) |
| Окно | WS_EX_NOACTIVATE | `type: 'panel'`, видно на всех рабочих столах |
| Скриншоты ⌘⇧3/⌘⇧4/⌘⇧5 | — | слежение за папкой скринов (`electron/main/macScreenshots.ts`), скрин кладётся в буфер и попадает в историю |
| Автозапуск | Run-ключ реестра | `SMAppService` (`app.setLoginItemSettings`, type `mainAppService`) |
| Трей | иконка 32px | template-иконка 18pt в строке меню |
| Автообновление | electron-updater | отключено (обновлялось бы на Windows-сборку) |
| Подписи | Ctrl+, Alt+, Explorer | ⌘, ⌥, Finder (`src/i18n/index.ts`, `HotkeyRecorder.tsx`) |
| Шрифты | — | исправлен CSP (`font-src data:`) |

## Проверено

- Текст, картинка, файл из Finder попадают в историю.
- Скрин-файл с меткой `kMDItemIsScreenCapture` в папке скринов попадает в историю; обычные картинки в той же папке игнорируются.
- Сборка `.app`, запуск, иконка в строке меню, нет иконки в Dock.

## Известные проблемы / что улучшать

- **Dock слева.** Если Dock стоит слева (как у Сергея), он перехватывает наведение на левый край. Нужна опция «панель справа» или авто-переключение края.
- Горячая клавиша ⌥C регистрируется (`registered=true`), но не проверена вживую.
- Вставка кликом, поиск с возвратом фокуса и перетаскивание наружу не проверены вживую.
- При включённой плавающей миниатюре скриншота macOS пишет файл через ~5 секунд — скрин появится с этой задержкой (миниатюру можно отключить: ⌘⇧5 → Параметры).
- Сборка только arm64, без подписи Apple (ad-hoc).
