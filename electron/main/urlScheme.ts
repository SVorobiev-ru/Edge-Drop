export const URL_SCHEME = 'edgedrop'
const URL_MAX_LENGTH = 2048
const URL_SEARCH_MAX_CHARS = 500

export type UrlCommand =
  | { action: 'toggle' }
  | { action: 'open' }
  | { action: 'search'; query: string }

function onlyParams(params: URLSearchParams, allowed: string[]): boolean {
  const keys = [...params.keys()]
  return keys.every((key) => allowed.includes(key)) && new Set(keys).size === keys.length
}

export function parseEdgeDropUrl(raw: unknown): UrlCommand | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > URL_MAX_LENGTH) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== `${URL_SCHEME}:`) return null
  if (url.username || url.password || url.port || url.hash) return null
  if (url.pathname !== '' && url.pathname !== '/') return null
  const params = url.searchParams
  switch (url.hostname.toLowerCase()) {
    case 'toggle':
      return [...params.keys()].length === 0 ? { action: 'toggle' } : null
    case 'open':
      return [...params.keys()].length === 0 ? { action: 'open' } : null
    case 'search': {
      if (!onlyParams(params, ['q'])) return null
      const query = params.get('q')
      if (query === null) return null
      const trimmed = query.trim()
      if (!trimmed || Array.from(trimmed).length > URL_SEARCH_MAX_CHARS || /\p{Cc}/u.test(trimmed)) return null
      return { action: 'search', query: trimmed }
    }
    default:
      return null
  }
}
