/** Local, renderer-only emoji picker preferences. Not part of Settings IPC. */

const RECENTS_KEY = 'edge-drop.emoji.recents'

interface MinimalStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function storage(): MinimalStorage | null {
  try {
    const g = globalThis as { localStorage?: MinimalStorage }
    return g.localStorage ?? null
  } catch {
    return null
  }
}

export function loadRecents(): string[] {
  const raw = storage()?.getItem(RECENTS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length < 80)
  } catch {
    return []
  }
}

export function saveRecents(unifieds: readonly string[]): void {
  try {
    storage()?.setItem(RECENTS_KEY, JSON.stringify(unifieds))
  } catch {
    /* quota / private mode */
  }
}
