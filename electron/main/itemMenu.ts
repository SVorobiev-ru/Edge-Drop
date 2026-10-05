import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { ItemKind, SourceApp } from '../../shared/types'

export type Translate = (key: string, params?: Record<string, string | number>) => string

export interface ItemMenuContext {
  kind: ItemKind
  pinned: boolean
  sub: boolean
  canPreview: boolean
  canReveal: boolean
  ignoreApp?: SourceApp
}

export interface ItemMenuActions {
  paste(): void
  pastePlain(): void
  copy(): void
  togglePin(): void
  rename(): void
  preview(): void
  reveal(): void
  addToQueue(): void
  ignoreApp(): void
  remove(): void
}

function menuLabel(text: string): string {
  return text.replace(/&/g, '&&')
}

export function buildItemMenuTemplate(ctx: ItemMenuContext, actions: ItemMenuActions, t: Translate): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [
    { label: menuLabel(t('menu.paste')), click: () => actions.paste() }
  ]
  if (ctx.kind === 'text' && !ctx.sub) {
    template.push({ label: menuLabel(t('menu.pastePlain')), click: () => actions.pastePlain() })
  }
  template.push({ label: menuLabel(t('menu.copy')), click: () => actions.copy() })

  const middle: MenuItemConstructorOptions[] = []
  if (!ctx.sub) {
    middle.push({ label: menuLabel(t(ctx.pinned ? 'menu.unpin' : 'menu.pin')), click: () => actions.togglePin() })
    middle.push({ label: menuLabel(t('menu.rename')), click: () => actions.rename() })
  }
  if (ctx.canPreview) middle.push({ label: menuLabel(t('menu.preview')), click: () => actions.preview() })
  if (ctx.canReveal) middle.push({ label: menuLabel(t('menu.revealInFinder')), click: () => actions.reveal() })
  if (!ctx.sub) middle.push({ label: menuLabel(t('menu.addToQueue')), click: () => actions.addToQueue() })
  if (middle.length > 0) template.push({ type: 'separator' }, ...middle)

  if (ctx.ignoreApp) {
    const app = ctx.ignoreApp.name || ctx.ignoreApp.bundleId
    template.push({ type: 'separator' }, { label: menuLabel(t('menu.ignoreApp', { app })), click: () => actions.ignoreApp() })
  }

  template.push({ type: 'separator' }, { label: menuLabel(t('menu.delete')), click: () => actions.remove() })
  return template
}

export interface SelectionMenuContext {
  allText: boolean
  stackable: boolean
  allPinned: boolean
}

export interface SelectionMenuActions {
  paste(): void
  pastePlain(): void
  copy(): void
  stack(): void
  togglePin(): void
  remove(): void
}

export function buildSelectionMenuTemplate(ctx: SelectionMenuContext, actions: SelectionMenuActions, t: Translate): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [
    { label: menuLabel(t('menu.paste')), click: () => actions.paste() }
  ]
  if (ctx.allText) template.push({ label: menuLabel(t('menu.pastePlain')), click: () => actions.pastePlain() })
  template.push({ label: menuLabel(t('menu.copy')), click: () => actions.copy() }, { type: 'separator' })
  if (ctx.stackable) template.push({ label: menuLabel(t('selection.stack')), click: () => actions.stack() })
  template.push(
    { label: menuLabel(t(ctx.allPinned ? 'menu.unpin' : 'menu.pin')), click: () => actions.togglePin() },
    { type: 'separator' },
    { label: menuLabel(t('menu.delete')), click: () => actions.remove() }
  )
  return template
}

export function popupItemMenu(template: MenuItemConstructorOptions[], window: BrowserWindow | null): Promise<void> {
  const menu = Menu.buildFromTemplate(template)
  return new Promise((resolve) => {
    const callback = (): void => resolve()
    if (window && !window.isDestroyed()) menu.popup({ window, callback })
    else menu.popup({ callback })
  })
}
