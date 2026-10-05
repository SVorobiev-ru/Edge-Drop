import { shell } from 'electron'

const EXTERNAL_PROTOCOLS: readonly string[] = ['https:', 'mailto:']

export function isAllowedExternalUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  try {
    return EXTERNAL_PROTOCOLS.includes(new URL(raw).protocol)
  } catch {
    return false
  }
}

function documentKey(raw: string): string | null {
  try {
    const url = new URL(raw)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return null
  }
}

export function isSameDocumentNavigation(currentUrl: string, targetUrl: string): boolean {
  const current = documentKey(currentUrl)
  return current !== null && current === documentKey(targetUrl)
}

export function openExternalIfAllowed(url: string): boolean {
  if (!isAllowedExternalUrl(url)) {
    console.warn('[WebGuard] Blocked external URL with a disallowed scheme')
    return false
  }
  void shell.openExternal(url)
  return true
}

export function installMacWebGuards(contents: Electron.WebContents): void {
  if (process.platform !== 'darwin') return
  contents.setWindowOpenHandler((details) => {
    openExternalIfAllowed(details.url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (!isSameDocumentNavigation(contents.getURL(), url)) event.preventDefault()
  })
}
