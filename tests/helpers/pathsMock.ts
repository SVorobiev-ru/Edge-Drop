import { join } from 'node:path'

type PathFn = () => string

export interface PathsMockOptions {
  root?: string | PathFn
  appPath?: string
  tempDir?: string | PathFn
  PATHS?: Record<string, PathFn>
}

function lazy(value: string | PathFn): PathFn {
  return typeof value === 'function' ? value : () => value
}

export function pathsModuleMock(o: PathsMockOptions = {}): Record<string, unknown> {
  const root = lazy(o.root ?? '/mock/userData')
  const appPath = o.appPath ?? '/mock/app'
  const tempDir = o.tempDir ? lazy(o.tempDir) : () => join(root(), 'temp')
  const PATHS: Record<string, PathFn> = {
    root,
    payloadsDir: () => join(root(), 'payloads'),
    imagesDir: () => join(root(), 'images'),
    thumbnailsDir: () => join(root(), 'thumbnails'),
    indexFile: () => join(root(), 'items.json'),
    settingsFile: () => join(root(), 'settings.json'),
    stagedTempRegistryFile: () => join(root(), 'temp-staged.json'),
    tempDir,
    icon: () => `${appPath}/resources/icon.png`,
    trayIcon: () => `${appPath}/resources/tray.png`,
    trayDarkIcon: () => `${appPath}/resources/tray-dark.png`,
    ...o.PATHS
  }
  return {
    PATHS,
    getUnpackagedTempDir: () => PATHS.tempDir(),
    toUnpackagedFilePath: (p: string) => p,
    toUnpackagedFilePaths: (ps: string[]) => ps
  }
}
