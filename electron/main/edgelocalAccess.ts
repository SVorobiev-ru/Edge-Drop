import { realpathSync } from 'node:fs'
import { basename, dirname, join, normalize, sep } from 'node:path'
import type { ItemData } from '../../shared/types'

export function collectItemFilePaths(items: readonly { data: ItemData }[]): Set<string> {
  const paths = new Set<string>()
  for (const item of items) {
    if (item.data.kind !== 'files') continue
    for (const p of item.data.paths) {
      if (typeof p === 'string' && p) paths.add(normalize(p))
    }
  }
  return paths
}

export function resolveRealPath(filePath: string): string {
  const target = normalize(filePath)
  const missing: string[] = []
  let current = target
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing)
    } catch {
      const parent = dirname(current)
      if (parent === current) return target
      missing.unshift(basename(current))
      current = parent
    }
  }
}

export function isPathInside(rootDir: string, filePath: string): boolean {
  if (!rootDir || !filePath) return false
  const root = resolveRealPath(rootDir)
  const target = resolveRealPath(filePath)
  const prefix = root.endsWith(sep) ? root : root + sep
  return target.startsWith(prefix)
}

export function isServableLocalPath(
  filePath: string,
  allowed: { itemPaths: ReadonlySet<string>; roots: readonly string[] }
): boolean {
  if (!filePath || filePath.includes('\0')) return false
  const target = normalize(filePath)
  if (allowed.itemPaths.has(target)) return true
  return allowed.roots.some((rootDir) => isPathInside(rootDir, target))
}
