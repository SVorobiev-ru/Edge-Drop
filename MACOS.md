# Edge-Drop for macOS

This repository is a fork of [Deepender25/Edge-Drop](https://github.com/Deepender25/Edge-Drop), the Windows clipboard shelf by Deepender, ported to macOS. The design and the feature set follow the original; the code base is shared, and the Windows build is kept working. The license is unchanged (Apache-2.0, see [LICENSE](LICENSE)).

Builds are available for Apple silicon (arm64) and Intel (x64) and require macOS 11 or later.

## Install from a release

1. Download the DMG for your Mac from the [releases page](https://github.com/SVorobiev-ru/Edge-Drop/releases/latest): `Edge-Drop-<version>-mac-arm64.dmg` for Apple silicon, `Edge-Drop-<version>-mac-x64.dmg` for Intel. A ZIP with the same app is published next to each DMG.
2. Open the DMG and drag **Edge-Drop** into **Applications**.
3. Remove the quarantine attribute and start the app:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Edge-Drop.app
   open /Applications/Edge-Drop.app
   ```

Why step 3 is needed: the build is signed ad-hoc. It has no Apple Developer ID and is not notarized, so Gatekeeper refuses to open a copy downloaded with a browser. `xattr -dr com.apple.quarantine` removes only the quarantine mark that the browser put on the download; it does not change the app itself.

If you prefer not to use Terminal: try to open the app once, then go to **System Settings → Privacy & Security**, scroll to the message about Edge-Drop and click **Open Anyway**.

Edge-Drop is a menu bar app: it has no Dock icon. Look for its icon in the menu bar.

## Permissions

| Permission | Why | When macOS asks |
|---|---|---|
| Accessibility | Pasting an item with a click sends ⌘V to the app you were working in | On the first paste. macOS shows its own access prompt, and Edge-Drop shows a notification that opens **System Settings → Privacy & Security → Accessibility** when clicked |
| Desktop, Documents, Downloads folders | Reading copied files and screenshots stored there | The first time such a file is read. The request for Desktop may appear on the first launch, because the app watches the screenshot folder |
| Automation (System Events) | Fallback paste path, used only if the native ⌘V event cannot be posted | Only if the fallback is used |

Copying, the history, drag-out and search work without Accessibility. Only click-to-paste needs it.

### Paste stopped working after an update

macOS ties the Accessibility grant to the code signature. An ad-hoc signature is different in every build, so after an update the existing entry no longer matches the app, even though the switch still looks enabled.

Fix: open **System Settings → Privacy & Security → Accessibility**, select Edge-Drop, remove it with the **−** button, then paste once from Edge-Drop and grant access again. The same from Terminal:

```bash
tccutil reset Accessibility com.edgedrop.app
tccutil reset PostEvent com.edgedrop.app
```

After the reset, turn Edge-Drop on again in **System Settings → Privacy & Security → Accessibility**.

## Updates

Edge-Drop checks the releases of this fork and tells you when a newer version is available. The update button opens the release page in your browser; download the DMG and install it over the old copy as described above. There is no automatic download or installation on macOS.

The check follows the update setting: it runs in the automatic and notify modes and is fully network-silent when updates are turned off.

Versions follow the scheme `<upstream version>-mac.<N>`, for example `0.3.2-mac.1`: the upstream Edge-Drop version the build is based on, then the revision of the port. `0.4.0-mac.1` is newer than `0.3.2-mac.5`.

## Build from source

```bash
npm install
npm run install:mac
```

`install:mac` builds the `.app` for the architecture of your Mac, signs it ad-hoc, quits a running Edge-Drop, replaces `/Applications/Edge-Drop.app` and starts it.

| Option | Effect |
|---|---|
| `npm run install:mac -- --no-build` | Install the bundle that is already in `dist/` |
| `npm run install:mac -- --no-launch` | Do not start the app after installing |
| `EDGE_DROP_SIGN_IDENTITY="<certificate name>" npm run install:mac` | Sign with a certificate from your keychain instead of ad-hoc |

With a stable certificate the Accessibility grant survives rebuilds. List the available ones with `security find-identity -v -p codesigning`.

Other scripts:

| Script | Result |
|---|---|
| `npm run dev` | Run from source with hot reload |
| `npm run build:mac` | Unpacked `.app` for the current architecture in `dist/mac-arm64` or `dist/mac` |
| `npm run dist:mac:arm64` | DMG and ZIP for Apple silicon in `dist/` |
| `npm run dist:mac:x64` | DMG and ZIP for Intel in `dist/` |
| `npm run dist:mac` | Both architectures |
| `bash scripts/verify-mac-dist.sh <arm64\|x64>` | Check the signature, architecture and Info.plist of the built DMG and ZIP |

`npm install` only downloads the native modules (koffi, resvg) for the architecture of the machine. To build the other architecture locally, the `dist:mac*` scripts stop and print the exact `npm install --no-save --force …` command that adds the missing binaries. Each package contains only the binaries of its own architecture.

### Publishing a release

Releases are built by GitHub Actions ([release-mac.yml](.github/workflows/release-mac.yml)): raise `macRevision` in `package.json`, commit, then push the tag `v<upstream version>-mac.<macRevision>`, for example `v0.3.2-mac.2`. `version` in `package.json` stays the upstream version and changes only when upstream is merged; `macRevision` then starts again at 1. `node scripts/mac-version.cjs` prints the resulting macOS version, and the `build:mac` and `dist:mac*` scripts pass it to electron-builder, so the app, its Info.plist and the artifact names carry the suffix while Windows builds and `npm run dev` keep the plain upstream version. The workflow builds arm64 and x64 on matching runners, verifies the artifacts and publishes the release with both DMGs and both ZIPs. The tag must match the output of `scripts/mac-version.cjs`, otherwise the build stops. Do not mark these releases as pre-release: the in-app check skips pre-releases and drafts.

## Windows and macOS side by side

| Area | Windows | macOS |
|---|---|---|
| Clipboard change detection | `GetClipboardSequenceNumber` | `NSPasteboard.changeCount` through koffi |
| Files copied in the file manager | `FileNameW` / PowerShell | `NSFilenamesPboardType` / `public.file-url` from Finder |
| Putting files on the clipboard | PowerShell `SetFileDropList` | `NSPasteboard.writeObjects` called natively (koffi); JXA is the fallback |
| Click-to-paste | Ctrl+V sent with SendKeys | ⌘V posted as a CoreGraphics keyboard event with the virtual key code of V; needs Accessibility. `osascript` is only a fallback |
| Returning focus after search | `GetForegroundWindow` / `SetForegroundWindow` | `NSWorkspace.frontmostApplication` and `activateWithOptions:` |
| Panel window | `WS_EX_NOACTIVATE` | Non-activating panel window, visible on every Space including full-screen Spaces |
| Screenshots | Snipping Tool puts them on the clipboard | Screenshots saved to a file (⌘⇧3, ⌘⇧4, ⌘⇧5) are added straight to the history; the clipboard is not touched. Screenshots sent to the clipboard (⌃⌘⇧3, ⌃⌘⇧4) arrive as a regular copy |
| Updates | electron-updater downloads and installs | Notification and a button that opens the release page |
| Tray / menu bar | Tray icon | Template icon in the menu bar: left click toggles the panel, right click (or Control-click) opens the menu |
| Fullscreen | Detected with `SHQueryUserNotificationState` | Detected for apps in a native full-screen Space; edge hover is suppressed there, the hotkey and the menu bar icon still open the panel |
| Screen edge on first launch | Left | Chosen by the Dock position: right edge if the Dock is on the left, left edge otherwise |
| Launch at login | Registry Run key, StartupTask in the Store build | `SMAppService` (login item of the main app) |
| Labels | Ctrl, Alt, Explorer | ⌘, ⌥, Finder |

## Known limitations

- **No Developer ID, no notarization.** Every installation needs the quarantine step, and the Accessibility grant has to be renewed after each update.
- **Accessibility has to be granted again after every update.** Each build carries a new ad-hoc signature, so macOS stops trusting the existing entry and click-to-paste only copies. Turn Edge-Drop on again in **System Settings → Privacy & Security → Accessibility**; if the switch already looks enabled, remove the entry and add it again, or use `tccutil reset` as described in [Paste stopped working after an update](#paste-stopped-working-after-an-update).
- **The history is encrypted with a key from the login keychain.** Edge-Drop stores the history through Electron `safeStorage`, which keeps its key in the keychain item **Edge-Drop Safe Storage**. After an update macOS may ask for access to that item: choose **Always Allow**. If access is denied, the history cannot be decrypted and the app starts with an empty list. The encrypted file is not deleted at that moment: a copy is saved next to it as `items.json.corrupted.<timestamp>` in `~/Library/Application Support/edge-drop/`. Edge-Drop does not restore that copy by itself, and `items.json` is overwritten with the new history the next time it is saved.
- **The default hotkey ⌥C replaces the character of that key combination.** While Edge-Drop runs, ⌥C toggles the panel in every app, so the character the combination types in your layout (for example «ç») can no longer be entered with it. Choose another hotkey in the settings if you need that character.
- **Keyboard layouts that move V (Dvorak and similar).** ⌘V is sent by the physical position of the V key on a QWERTY keyboard. On a layout where that key produces another letter, click-to-paste may trigger a different shortcut.
- **Dock on the same side as the panel.** The Dock occupies the outer pixels of that edge, so Edge-Drop reacts in a narrow band next to it. If opening the panel by hover is unreliable, move the panel to another edge in the settings.
- **Stage Manager.** The port has not been verified with Stage Manager; edge hover and returning focus may behave differently there.
- **Fullscreen games.** Only native full-screen Spaces are detected. A game that draws its own borderless fullscreen window is not recognized, so edge hover stays active over it.
- **Screenshot delay.** With the floating thumbnail enabled, macOS writes the screenshot file a few seconds after the capture, and the item appears in the history with the same delay. The thumbnail can be turned off in ⌘⇧5 → Options.
