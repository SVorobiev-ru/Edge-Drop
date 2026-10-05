import { net } from 'electron'

export interface CachedUpdateInfo {
  hasUpdate: boolean
  latestVersion: string
  downloaded: boolean
  downloadProgress?: { percent: number; bytesPerSecond?: number; transferred?: number; total?: number }
}

export let _cachedUpdateInfo: CachedUpdateInfo | null = null

export function getCachedUpdateState(): CachedUpdateInfo | null {
  return _cachedUpdateInfo
}

export function setCachedUpdateInfo(info: CachedUpdateInfo | null): void {
  _cachedUpdateInfo = info
}

/**
 * Fast direct check against GitHub Releases API (< 0.5s) with a 4s max timeout.
 */
export function checkGitHubReleaseFast<T = { tag_name?: string; html_url?: string }>(
  url = 'https://api.github.com/repos/Deepender25/Edge-Drop/releases/latest'
): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const request = net.request({
        method: 'GET',
        url
      })
      request.setHeader('User-Agent', 'Edge-Drop-App')
      request.setHeader('Accept', 'application/vnd.github.v3+json')

      const timer = setTimeout(() => {
        try { request.abort() } catch { /* ignore */ }
        resolve(null)
      }, 4000)

      request.on('response', (response) => {
        let body = ''
        response.on('data', (chunk) => { body += chunk })
        response.on('end', () => {
          clearTimeout(timer)
          try {
            if (response.statusCode === 200) {
              resolve(JSON.parse(body))
            } else {
              resolve(null)
            }
          } catch {
            resolve(null)
          }
        })
      })

      request.on('error', () => {
        clearTimeout(timer)
        resolve(null)
      })

      request.end()
    } catch {
      resolve(null)
    }
  })
}
