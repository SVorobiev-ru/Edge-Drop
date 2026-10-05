# Edge-Drop for macOS

This repository is a fork of [Deepender25/Edge-Drop](https://github.com/Deepender25/Edge-Drop), the Windows clipboard shelf by Deepender, ported to macOS. The design and the feature set follow the original; the code base is shared, and the Windows build is kept working. The license is unchanged (Apache-2.0, see [LICENSE](LICENSE)).

Builds are available for Apple silicon (arm64) and Intel (x64) and require macOS 12 or later.

## Install from a release

1. Download the DMG for your Mac from the [releases page](https://github.com/SVorobiev-ru/Edge-Drop/releases/latest): `Edge-Drop-<version>-mac-arm64.dmg` for Apple silicon, `Edge-Drop-<version>-mac-x64.dmg` for Intel. A ZIP with the same app is published next to each DMG.
2. Open the DMG and drag **Edge-Drop** into **Applications**.
3. Remove the quarantine attribute and start the app:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Edge-Drop.app
   open /Applications/Edge-Drop.app
   ```

Why step 3 is needed: the build has no Apple Developer ID and is not notarized (it is signed ad-hoc or with the fork's self-signed certificate, see [Code signature of release builds](#code-signature-of-release-builds)), so Gatekeeper refuses to open a copy downloaded with a browser. `xattr -dr com.apple.quarantine` removes only the quarantine mark that the browser put on the download; it does not change the app itself.

If you prefer not to use Terminal: try to open the app once, then go to **System Settings → Privacy & Security**, scroll to the message about Edge-Drop and click **Open Anyway**.

Edge-Drop is a menu bar app: it has no Dock icon. Look for its icon in the menu bar. Opening the app again from Finder or Spotlight while it runs opens the panel.

The default hotkey is ⌘⇧V. Edge-Drop does not start at login unless you turn it on: the welcome tour asks about it, and the switch stays in the settings.

### Homebrew

[packaging/homebrew/edge-drop.rb](packaging/homebrew/edge-drop.rb) is a cask template for a personal tap. It points at the release DMGs of this fork (`Edge-Drop-<version>-mac-arm64.dmg` and `Edge-Drop-<version>-mac-x64.dmg`). After a release, `bash scripts/update-cask.sh <version> <path to the cask in your tap>` downloads both DMGs and fills in the version and the two `sha256` values; with `--dist` it hashes the files from the local `dist/` folder instead. Without a path it updates the template in this repository. Publish the tap as a repository named `homebrew-<tap>` with the file in `Casks/edge-drop.rb`, then install with `brew install --cask <user>/<tap>/edge-drop`. Homebrew does not notarize anything either: the quarantine step above still applies.

## Permissions

| Permission | Why | When macOS asks |
|---|---|---|
| Accessibility | Pasting an item with a click sends ⌘V to the app you were working in | On the first paste. macOS shows its own access prompt, and Edge-Drop shows a notification that opens **System Settings → Privacy & Security → Accessibility** when clicked |
| Desktop, Documents, Downloads folders | Reading copied files and screenshots stored there | The first time such a file is read. The request for Desktop may appear on the first launch, because the app watches the screenshot folder |
| Automation (System Events) | Fallback paste path, used only if the native ⌘V event cannot be posted | Only if the fallback is used |

Copying, the history, drag-out and search work without Accessibility. Only click-to-paste needs it.

### Paste stopped working after an update

macOS ties the Accessibility grant to the code signature. An ad-hoc signature is different in every build, so after an update the existing entry no longer matches the app, even though the switch still looks enabled. Releases signed with the fork's self-signed certificate keep the same identity, so the grant survives updates between such releases; the reset below is needed once, when moving from an ad-hoc build to the first build signed with the certificate, and again if the certificate is ever replaced.

Fix: open **System Settings → Privacy & Security → Accessibility**, select Edge-Drop, remove it with the **−** button, then paste once from Edge-Drop and grant access again. The same from Terminal:

```bash
tccutil reset Accessibility com.edgedrop.app
tccutil reset PostEvent com.edgedrop.app
```

After the reset, turn Edge-Drop on again in **System Settings → Privacy & Security → Accessibility**.

## Updates

Edge-Drop checks the releases of this fork and tells you when a newer version is available. The check runs shortly after launch, then once every 24 hours while the app runs, and after the Mac wakes from sleep if the last check is more than 6 hours old.

**Download and install** updates the app in place:

1. Edge-Drop downloads the ZIP for your Mac (`Edge-Drop-<version>-mac-arm64.zip` or `-mac-x64.zip`) from the release and shows the progress.
2. It checks the SHA-256 of the ZIP against `SHA256SUMS.txt` published with the same release, unpacks it, and checks that the new app has the bundle identifier `com.edgedrop.app` and a valid code signature (`codesign --verify --deep --strict`). Then it reads the signature of the running app (`codesign -dv`):
   - **Signed with a certificate** (the fork's self-signed certificate or a Developer ID: the output has `Authority=` lines or a `TeamIdentifier`): Edge-Drop reads the designated requirement of the running app (`codesign -d -r-`) and requires the new app to satisfy it (`codesign --verify --deep --strict -R '=<requirement>'`). For the fork's certificate that requirement is "bundle identifier `com.edgedrop.app`, signed with this certificate", so an update signed with any other certificate, or ad-hoc, is refused.
   - **Ad-hoc signed** (`Signature=adhoc`, for example a build from source): the designated requirement of such a build is its own code hash and no other build can satisfy it, so only the checks above apply: checksum from the release, bundle identifier and a valid signature.
   - If the signature of the running app cannot be read, the update is refused.
3. **Restart** quits Edge-Drop. A small helper script waits for it to exit, copies the new app next to the old one, swaps them, removes the quarantine attribute from the new copy and starts it. The old copy is kept until the new one is running. If the swap or the launch fails, the old copy is put back and started. If the new version is not seen running within 60 seconds, the helper leaves it in place (it may still be starting) and keeps the old copy next to it as a hidden `.Edge-Drop.app.backup-<tag>` folder in the same directory; delete that folder once the new version works. The helper writes its log to `~/Library/Logs/edge-drop/update.log`.

Nothing is downloaded until you press the button. If any step fails (including a signature that does not match the running app, or a quit that was cancelled before the helper could run), if the release has no checksum file, or if Edge-Drop cannot replace its own app bundle (for example, it was installed by another user account, or it runs from a DMG or a quarantined download), Edge-Drop opens the release page in the browser instead; install the DMG over the old copy as described above.

The check follows the update setting: it runs automatically in the automatic and notify modes. With updates turned off there are no automatic requests, but **Check for updates** in the settings still contacts GitHub. On macOS the automatic mode also only notifies: downloading always waits for the button.

Versions follow the scheme `<upstream version>-mac.<N>`, for example `0.3.2-mac.1`: the upstream Edge-Drop version the build is based on, then the revision of the port. `0.4.0-mac.1` is newer than `0.3.2-mac.5`.

## Opening Edge-Drop from a link (`edgedrop://`)

Edge-Drop registers the `edgedrop://` URL scheme, so other apps, scripts and the Shortcuts app can control the panel:

| URL | Action |
|---|---|
| `edgedrop://toggle` | Open the panel, or close it if it is open |
| `edgedrop://open` | Open the panel |
| `edgedrop://search?q=invoice` | Open the panel with the search field filled in (URL-encode the text, up to 500 characters) |

The panel opened from a link takes the keyboard, as with the hotkey. Any other URL, extra parameter or malformed value is ignored.

From Terminal: `open 'edgedrop://search?q=invoice'`.

In the Shortcuts app: create a shortcut, add the **Open URLs** action, enter `edgedrop://open` (or another URL from the table), then assign a keyboard shortcut to it in the shortcut details or add it to the menu bar.

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
| `EDGE_DROP_SIGN_IDENTITY="<certificate name or SHA-1 hash>" npm run install:mac` | Sign with a certificate from your keychain instead of ad-hoc |

With a stable certificate the Accessibility grant survives rebuilds. List the available ones with `security find-identity -v -p codesigning`.

Other scripts:

| Script | Result |
|---|---|
| `npm run dev` | Run from source with hot reload |
| `npm run build:mac` | Unpacked `.app` for the current architecture in `dist/mac-arm64` or `dist/mac` |
| `npm run dist:mac:arm64` | DMG and ZIP for Apple silicon in `dist/` |
| `npm run dist:mac:x64` | DMG and ZIP for Intel in `dist/` |
| `npm run dist:mac` | Both architectures |
| `bash scripts/verify-mac-dist.sh <arm64\|x64>` | Check the signature, architecture, Info.plist and `app.asar` contents of the built DMG and ZIP |
| `node scripts/check-mac-asar.cjs <Edge-Drop.app>` | Fail if `app.asar` holds anything except `out`, `resources`, `package.json` and `node_modules` |
| `bash scripts/smoke-test-mac.sh [Edge-Drop.app]` | Start the built binary with `--smoke-test`: it loads the native bridge, reads the pasteboard change count, prints one JSON line and exits without opening windows |
| `bash scripts/make-signing-cert.sh [dir]` | Generate a self-signed code-signing certificate for release builds |
| `bash scripts/update-cask.sh [--dist] [version] [cask]` | Fill the Homebrew cask with the version and checksums of a release |

`npm install` only downloads the native modules (koffi, resvg) for the architecture of the machine. To build the other architecture locally, the `dist:mac*` scripts stop and print the exact `npm install --no-save --force …` command that adds the missing binaries. Each package contains only the binaries of its own architecture.

### Publishing a release

Releases are built by GitHub Actions ([release-mac.yml](.github/workflows/release-mac.yml)): raise `macRevision` in `package.json`, commit, then push the tag `v<upstream version>-mac.<macRevision>`, for example `v0.3.2-mac.2`. `version` in `package.json` stays the upstream version and changes only when upstream is merged; `macRevision` then starts again at 1. `node scripts/mac-version.cjs` prints the resulting macOS version, and the `build:mac` and `dist:mac*` scripts pass it to electron-builder, so the app, its Info.plist and the artifact names carry the suffix while Windows builds and `npm run dev` keep the plain upstream version. The workflow builds arm64 and x64 on matching runners, signs them (see below), verifies the artifacts and publishes the release with both DMGs, both ZIPs and `SHA256SUMS.txt` with their checksums. The in-app update refuses a release without that file. The tag must match the output of `scripts/mac-version.cjs`, otherwise the build stops. Do not mark these releases as pre-release: the in-app check skips pre-releases and drafts.

### Code signature of release builds

Without an Apple Developer ID the app can still carry a stable signature. An ad-hoc signature gives every build a new identity, and macOS then drops the Accessibility grant and asks for the keychain item again after each update. A self-signed code-signing certificate fixes that: the designated requirement of the app becomes "bundle identifier `com.edgedrop.app`, signed with this certificate", and it stays the same from release to release.

One-time setup by the repository owner:

1. Run `bash scripts/make-signing-cert.sh ~/edge-drop-signing`. It generates a private key and a self-signed certificate with the code-signing extended key usage, valid for 10 years, packs them into a password-protected `.p12` and prints two `gh secret set` commands.
2. Run the two printed commands. They store the secrets `MAC_SIGN_P12_BASE64` and `MAC_SIGN_P12_PASSWORD` in the repository.
3. Keep the `.p12` and its password somewhere safe. A new certificate is a new identity: every user has to grant Accessibility once more.

The release workflow imports the certificate into a temporary keychain (`scripts/ci-import-signing-cert.sh`), sets `EDGE_DROP_SIGN_IDENTITY` to the SHA-1 hash of the signing identity (and `EDGE_DROP_SIGN_NAME` to the certificate name), and the `afterPack` hook (`scripts/mac-adhoc-sign.cjs`) signs the bundle with it; `scripts/verify-mac-dist.sh` then checks that the DMG and the ZIP carry that signature. The keychain is deleted at the end of the job. When the secrets are absent, nothing is imported and the build is signed ad-hoc exactly as before.

To sign local builds with the same identity, import the `.p12` into your login keychain once (the script prints the command) and pass `EDGE_DROP_SIGN_IDENTITY` to `npm run install:mac` or `npm run dist:mac*`.

What the certificate does not change: it is not issued by Apple, so the build is still not notarized and Gatekeeper still quarantines the first install. The `xattr -dr com.apple.quarantine` step (or **Open Anyway**) stays.

## History storage

On macOS the history is not encrypted by the app. It is stored as plain JSON (`items.json`), with large texts in `payloads/` and images in `images/`, under `~/Library/Application Support/edge-drop/`, a folder only your user account can read (mode 0700). Protection of the data at rest is left to FileVault; turn it on in **System Settings → Privacy & Security → FileVault** if it is off.

Earlier macOS builds encrypted `items.json` with a key from the login keychain (item **Edge-Drop Safe Storage**). The first launch of a newer build reads that file, asking for keychain access if needed, and saves it again as plain JSON. If the file cannot be decrypted (access denied, keychain item removed), the app starts with an empty history and moves the old file aside as `items.json.encrypted-backup` in the same folder; it is not deleted and not restored automatically. Further unreadable copies are saved as `items.json.corrupted.<timestamp>`, and only the three newest are kept.

Each item also records the app it was copied from (bundle identifier and name). This is used for the "from …" label, search and the ignored apps list, and stays in the same local file.

Text in images and screenshots is recognized on the Mac with Apple's Vision framework (Settings → **Recognize text in images**); the recognized text is stored with the item for search. Nothing is sent anywhere.

## Windows and macOS side by side

| Area | Windows | macOS |
|---|---|---|
| Clipboard change detection | `GetClipboardSequenceNumber` | `NSPasteboard.changeCount` through koffi |
| Files copied in the file manager | `FileNameW` / PowerShell | `NSFilenamesPboardType` / `public.file-url` from Finder |
| Putting files on the clipboard | PowerShell `SetFileDropList` | `NSPasteboard.writeObjects` called natively (koffi); JXA is the fallback |
| Click-to-paste | Ctrl+V sent with SendKeys | ⌘V posted as a CoreGraphics keyboard event with the virtual key code of V; needs Accessibility. `osascript` is only a fallback |
| Returning focus after search | `GetForegroundWindow` / `SetForegroundWindow` | `NSWorkspace.frontmostApplication`; on macOS 14 and later `yieldActivationToApplication:` with `activateFromApplication:options:`, otherwise `activateWithOptions:` |
| Panel window | `WS_EX_NOACTIVATE` | Non-activating panel window, visible on every Space including full-screen Spaces |
| Clicks around the open panel | The whole panel window takes clicks while the panel is open | Only the visible panel and its flyouts take clicks; clicks on the transparent rest of the window reach the app below. The window covers the work area of its display, so moving the panel along the edges, resizing it or opening the preview never resizes or moves the window; only a move to another display does. While the panel is closed the window never takes clicks, and the app forces this if the panel interface stops responding or reports it closed |
| Panel size | Width 240-420 px in the settings (Position), 270 px by default; height in the settings; the top dock keeps its own size | Drag the inner edge of the panel to change its thickness (side panel 240-420 px, 270 px by default; top and bottom dock 170-400 px, 210 px by default) and either end to change its length (side panel 30-100% of the screen height; dock from 480 px to the screen width, 1080 px by default). A 6 px strip on each of these edges shows a resize pointer |
| Panel position | Left, right or top edge, display and offset in the settings (Position) | Drag an empty part of the panel header: the panel stays attached to the edge of the display nearest to the pointer and slides along it. It moves to another edge (left, right, top or bottom) and to another display with the pointer, changing its shape smoothly on the way; releasing keeps it where it is. The bottom edge sits above the Dock and is available on macOS only |
| After a paste | The panel closes | The panel stays open, so several items can be pasted in a row; focus goes back to the app in front for ⌘V. A paste with Return keeps keyboard control of the panel. Pasted items move to the top when the panel closes |
| Copy from the panel | The copied item moves to the top | The item stays where it is |
| Search | Searches the current tab | Searches the current tab first, then lists matches from the other tabs under **From other tabs** |
| Reopening the panel | Clears the search and leaves the settings and emoji views | Shows the same tab, scroll position, search, settings page and emoji view as when it was closed |
| Screenshots | Snipping Tool puts them on the clipboard | Screenshots saved to a file (⌘⇧3, ⌘⇧4, ⌘⇧5) are added straight to the history; the clipboard is not touched. Screenshots sent to the clipboard (⌃⌘⇧3, ⌃⌘⇧4) arrive as a regular copy |
| Updates | electron-updater downloads and installs | Own downloader: ZIP from the fork release, SHA-256 from `SHA256SUMS.txt`, bundle identifier and `codesign` check, swap by a helper script after quit; the release page is the fallback. electron-updater is not packed into the macOS build |
| Default hotkey | Alt+C | ⌘⇧V (an existing installation that still had ⌥C is moved to ⌘⇧V once) |
| Tray / menu bar | Tray icon | Template icon in the menu bar: left click toggles the panel, right click (or Control-click) opens the menu. The menu starts with the 8 most recent text and link items; choosing one pastes it into the app in front |
| App menu | None | **Settings…** (⌘,) and **Quit Edge-Drop** (⌘Q), available while Edge-Drop owns the keyboard |
| Keyboard | The panel never takes focus | A panel opened by the hotkey, the menu bar icon, the menu, a link or by opening the app again takes the keyboard (arrow keys, Return, typing to search) and hands it back to the previous app when it closes. Opening by hover never takes the keyboard |
| Closing the panel with Esc | Handled by the focused window | While the panel has the keyboard it handles Esc itself. When it was opened explicitly but does not have the keyboard, Esc is captured system-wide until the panel closes |
| Fullscreen | Detected with `SHQueryUserNotificationState` | Detected for apps in a native full-screen Space; edge hover is suppressed there, the hotkey and the menu bar icon still open the panel. With several displays, hover is suppressed only on the display that shows the full-screen window when that display can be determined |
| Screen edge on first launch | Left | Chosen by the Dock position: right edge if the Dock is on the left, left edge otherwise |
| Launch at login | Registry Run key, StartupTask in the Store build, on by default | `SMAppService` (login item of the main app) on macOS 13 and later, the legacy login item on macOS 12. Off by default on a new installation and offered in the welcome tour; an existing installation keeps its choice |
| History on disk | Encrypted with DPAPI (`safeStorage`) | Plain JSON in `~/Library/Application Support/edge-drop/`, readable only by your user account; see [History storage](#history-storage) |
| Theme | Dark | Follows the system appearance on a new installation (an existing installation keeps its theme); dark and light can be chosen in the settings. Native menus follow the same choice |
| Hiding from screen capture | Not available | Optional: the panel is excluded from screenshots, recordings and screen sharing |
| Labels | Ctrl, Alt, Explorer | ⌘, ⌥, Finder |

## Known limitations

- **No Developer ID, no notarization.** Every installation needs the quarantine step. With an ad-hoc signed build the Accessibility grant also has to be renewed after each update.
- **Accessibility has to be granted again after an update of an ad-hoc signed build.** Each such build carries a new ad-hoc signature, so macOS stops trusting the existing entry and click-to-paste only copies. Releases signed with the fork's self-signed certificate do not have this problem between each other. Turn Edge-Drop on again in **System Settings → Privacy & Security → Accessibility**; if the switch already looks enabled, remove the entry and add it again, or use `tccutil reset` as described in [Paste stopped working after an update](#paste-stopped-working-after-an-update).
- **The hotkey ⌘⇧V is taken from other apps.** While Edge-Drop runs, ⌘⇧V toggles the panel everywhere, so apps that use it for "paste as plain text" (Chrome, Slack and others) no longer receive it. Edge-Drop has its own plain-text paste in the settings; choose another hotkey if you need the app's shortcut. Avoid ⌥ with a letter as the hotkey: it replaces the character that combination types in your layout (for example «ç» for ⌥C).
- **The translucent panel blurs only the panel body.** The blur is a native layer under the open panel with rounded corners on the inner side. The small curved joints between the panel and the screen edge are translucent without blur.
- **Keyboard layouts that move V (Dvorak and similar).** ⌘V is sent by the physical position of the V key on a QWERTY keyboard. On a layout where that key produces another letter, click-to-paste may trigger a different shortcut.
- **Dock on the same side as the panel.** The Dock occupies the outer pixels of that edge, so Edge-Drop reacts in a narrow band next to it. This applies to the bottom edge as well when the Dock is at the bottom. If opening the panel by hover is unreliable, drag the panel to another edge.
- **Stage Manager.** The port has not been verified with Stage Manager; edge hover and returning focus may behave differently there.
- **Only https and mailto links open from the panel.** A copied link with another scheme (for example `http://`) can be pasted or dragged, but the open button does nothing.
- **Fullscreen games.** Only native full-screen Spaces are detected. A game that draws its own borderless fullscreen window is not recognized, so edge hover stays active over it.
- **Screenshot delay.** With the floating thumbnail enabled, macOS writes the screenshot file a few seconds after the capture, and the item appears in the history with the same delay. The thumbnail can be turned off in ⌘⇧5 → Options.
