macOS build of Edge-Drop from the [SVorobiev-ru/Edge-Drop](https://github.com/SVorobiev-ru/Edge-Drop) fork. The original Windows app is developed by Deepender at [Deepender25/Edge-Drop](https://github.com/Deepender25/Edge-Drop).

## Which file to download

| Mac | File |
|---|---|
| Apple silicon (M1 and later) | `Edge-Drop-<version>-mac-arm64.dmg` |
| Intel | `Edge-Drop-<version>-mac-x64.dmg` |

The ZIP files contain the same app without the disk image. Requires macOS 11 or later.

## Install

1. Open the DMG and drag **Edge-Drop** into **Applications**.
2. Remove the quarantine attribute and start the app:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Edge-Drop.app
   open /Applications/Edge-Drop.app
   ```

3. On the first paste from Edge-Drop, allow it in **System Settings → Privacy & Security → Accessibility**.

The build is signed ad-hoc: it has no Apple Developer ID and is not notarized, so macOS blocks a freshly downloaded copy until the quarantine attribute is removed. Without Terminal: try to open the app, then click **Open Anyway** in **System Settings → Privacy & Security**.

## Updating from an earlier build

Replace the app in **Applications** and repeat step 2. If click-to-paste stops working, remove Edge-Drop from the Accessibility list and add it again, or run:

```bash
tccutil reset Accessibility com.edgedrop.app
tccutil reset PostEvent com.edgedrop.app
```

After the reset, turn Edge-Drop on again in **System Settings → Privacy & Security → Accessibility**.

## Known limitations

- After every update macOS stops trusting the previous Accessibility entry, because the ad-hoc signature changes. Turn Edge-Drop on again in **System Settings → Privacy & Security → Accessibility**; if needed, remove the entry and add it again or use the `tccutil reset` commands above.
- The history is encrypted with a key from the login keychain. If macOS asks for access to **Edge-Drop Safe Storage** after an update, choose **Always Allow**. If access is denied, the history cannot be decrypted and the app starts with an empty list; a copy of the encrypted file stays in `~/Library/Application Support/edge-drop/` as `items.json.corrupted.<timestamp>`, but it is not restored automatically.
- The default hotkey ⌥C takes over that key combination in every app, so the character it types in your layout (for example «ç») cannot be entered with it. The hotkey can be changed in the settings.

Details, permissions and the full list of known limitations: [MACOS.md](https://github.com/SVorobiev-ru/Edge-Drop/blob/macos-port/MACOS.md).
