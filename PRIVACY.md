# Privacy Policy for Edge-Drop

**Last Updated**: October 2026

Edge-Drop is designed from the ground up with privacy and local execution as foundational principles.

---

### 1. Data Collection and Processing
Edge-Drop does not collect, store, or transmit any personal information to external servers or third-party services:
- **Clipboard Content**: Any text, links, code snippets, or images copied to your clipboard are processed and cached strictly on your local machine.
- **Files & Drag Staging**: Files dragged into Edge-Drop remain in their original filesystem locations or in a local temporary cache on your computer.
- **No Analytics or Telemetry**: Edge-Drop contains zero third-party tracking libraries, advertisements, or telemetry analytics.

---

### 2. Network Activity
- **Microsoft Store Version**: The Microsoft Store package of Edge-Drop makes no outbound network requests, except downloading an image you drag in from a web page (see below). All app updates and installations are managed natively and securely by the Windows Store.
- **Standalone Version (Direct Exe)**: The direct installer version only contacts the official GitHub Releases API (`api.github.com`) to check whether a newer version of the software is available. No user data, identifiers, or clipboard contents are sent with update checks.
- **macOS Version (fork builds)**: The macOS build contacts the GitHub Releases API (`api.github.com`) for the releases of the [SVorobiev-ru/Edge-Drop](https://github.com/SVorobiev-ru/Edge-Drop) fork: shortly after launch, then about once every 24 hours while the app runs, after the Mac wakes from sleep if the last check is more than 6 hours old, when you switch the update setting on, and when you press **Check for updates**. Only when you press **Download and install** does it download the update ZIP and its checksum file from the same GitHub release (GitHub serves the files from its download servers). Nothing is downloaded or installed automatically, and no user data, identifiers, or clipboard contents are sent. With updates turned off the app makes no automatic update requests; a manual **Check for updates** still contacts GitHub.
- **Images dropped from a web page (all versions)**: When you drag an image from a browser onto the shelf and the browser provides only its web address, Edge-Drop downloads that image from the address to store it in the history, like the browser itself would. Nothing else is sent with that request.

---

### 3. Local Storage and Data Retention
- All application settings, clipboard history, and pinned cards are stored locally in the standard Windows application data directory (`%LOCALAPPDATA%`).
- **macOS**: settings and history are stored in `~/Library/Application Support/edge-drop/`, a folder only your user account can read. The history is plain JSON and is not encrypted by the app; protection at rest relies on FileVault. A history file encrypted by an earlier macOS build is converted to plain JSON on the first launch; if it cannot be decrypted, it is kept as `items.json.encrypted-backup` in the same folder.
- **macOS**: each history item records the app it was copied from (bundle identifier and name). It stays in the local history file.
- **macOS**: text in images and screenshots is recognized on the Mac with Apple's Vision framework, and the recognized text is stored with the item for search. Images are never uploaded.
- You can clear your clipboard history, delete individual items, or wipe unpinned items at any time using the in-app controls.
- Uninstalling the application removes the local program files and settings.

---

### 4. Children's Privacy
Edge-Drop does not collect any personal information from anyone, including children under the age of 13.

---

### 5. Contact
If you have any questions or feedback regarding this Privacy Policy, you can open an issue or discussion on the official GitHub repository:
https://github.com/Deepender25/Edge-Drop
