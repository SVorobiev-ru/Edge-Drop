import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = join(__dirname, '..', '..')

function concat(files: string[]): string {
  return files.map((rel) => readFileSync(join(root, rel), 'utf8')).join('\n')
}

export function readSettingsSource(): string {
  return concat([
    'src/components/settings/useSettingsState.ts',
    'src/components/settings/SettingsFooter.tsx',
    'src/components/settings/UpdateCards.tsx',
    'src/components/settings/BehaviourCards.tsx',
    'src/components/settings/PositionCards.tsx',
    'src/components/settings/AppearanceCards.tsx',
    'src/components/settings/HorizontalSettings.tsx',
    'src/components/Settings.tsx'
  ])
}

export function readClipboardItemSource(): string {
  return concat([
    'src/components/ClipboardItem.tsx',
    'src/components/item/itemActions.ts',
    'src/components/item/ItemMeta.tsx',
    'src/components/item/Bundle.tsx',
    'src/components/item/ItemPreview.tsx'
  ])
}

export function readFlyoutSource(rel: string): string {
  return concat([
    rel,
    'src/components/SideFlyoutShell.tsx',
    'src/hooks/useSideFlyoutPlacement.ts',
    'src/lib/flyoutPlacement.ts'
  ])
}

export function readStyleSource(rel: string): string {
  const file = join(root, rel)
  return readFileSync(file, 'utf8').replace(/^@import '(.+)';\n/gm, (_line, part: string) => readFileSync(join(dirname(file), part), 'utf8'))
}
