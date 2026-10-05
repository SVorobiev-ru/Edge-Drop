import { useEffect } from 'react'
import { useStore } from '../store/appStore'
import { edge } from '../lib/edge'
import { closeShelf, openItemPreview } from '../lib/shelf'
import { getNavOrder, nextActiveAfterRemoval, resolveNavKey, type NavAction, type NavFocus } from '../lib/keyboardNav'
import { pasteOptionsFor, pastePlainFor } from '../lib/pasteOptions'
import { tryPaste } from '../lib/tryPaste'
import { playButtonClickSound, playDeleteSound, playToggleSound } from '../lib/soundEffects'
import { isHorizontalEdge } from '../../shared/panelPlacement'

const HEADER_FOCUSABLE = [
  '.blade .header button:not([disabled])',
  '.blade .header input',
  '.blade .header [tabindex]:not([tabindex="-1"])',
  '.blade > .search input',
  '.blade .emoji-search input'
].join(', ')

function isVisible(el: HTMLElement): boolean {
  if (el.closest('[aria-hidden="true"]')) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function headerControls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(HEADER_FOCUSABLE)).filter(isVisible)
}

function currentFocus(): NavFocus {
  const el = document.activeElement as HTMLElement | null
  if (!el || el === document.body) return 'none'
  if (el.closest('.emoji-search')) return 'editable'
  if (el.closest('.search') && el.tagName === 'INPUT') return 'search'
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return 'editable'
  if (el.closest('.blade .header')) return 'header'
  return 'none'
}

function cardElement(id: string): HTMLElement | null {
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id
  return document.querySelector<HTMLElement>(`.item-main[data-id="${escaped}"]`)
}

export function focusSearchField(text: string): void {
  const state = useStore.getState()
  const selector = state.emojiOpen ? '.blade .emoji-search input' : '.blade .search:not(.emoji-search) input'
  if (!state.emojiOpen && text) state.setQuery(state.query + text)
  const place = () => {
    const input = document.querySelector<HTMLInputElement>(selector)
    if (!input) return
    input.focus()
    if (state.emojiOpen && text) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, input.value + text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const end = input.value.length
    try { input.setSelectionRange(end, end) } catch { /* ignore */ }
  }
  window.requestAnimationFrame(place)
}

function cycleFocus(backwards: boolean): void {
  const controls = headerControls()
  if (controls.length === 0) return
  const index = controls.indexOf(document.activeElement as HTMLElement)
  const next = index < 0
    ? (backwards ? controls.length - 1 : 0)
    : (index + (backwards ? -1 : 1) + controls.length) % controls.length
  controls[next].focus()
}

function run(action: NavAction): boolean {
  const state = useStore.getState()
  const order = getNavOrder()
  const idAt = (index: number) => order[index]
  switch (action.type) {
    case 'none':
      return false
    case 'move':
      state.setActiveItemId(idAt(action.index) ?? null)
      return true
    case 'paste': {
      const id = idAt(action.index)
      const item = id ? state.items.find((it) => it.id === id) : undefined
      if (!item) return true
      state.setActiveItemId(id)
      if (state.previewItemId) state.setPreviewItemId(null)
      const opts = pasteOptionsFor(item, state.settings, action.invert, edge.platform)
      tryPaste(() => { void state.paste(item.id, opts, true).catch(() => {}) })
      return true
    }
    case 'copy': {
      const id = idAt(action.index)
      if (!id) return true
      playButtonClickSound()
      void state.copy(id).catch(() => {})
      state.pushToast({ id: `kb-copy-${Date.now()}`, message: 'item.copied', tone: 'info' })
      return true
    }
    case 'delete': {
      const id = idAt(action.index)
      if (!id) return true
      playDeleteSound()
      state.setActiveItemId(nextActiveAfterRemoval(order, id))
      void state.remove(id)
      return true
    }
    case 'pin': {
      const id = idAt(action.index)
      const item = id ? state.items.find((it) => it.id === id) : undefined
      if (!item) return true
      playToggleSound(!item.pinned)
      void state.togglePin(item.id, !item.pinned).catch(() => {})
      return true
    }
    case 'preview': {
      const id = idAt(action.index)
      if (id) openItemPreview(id)
      return true
    }
    case 'focusSearch':
      focusSearchField(action.text)
      return true
    case 'clearQuery':
      state.setQuery('')
      return true
    case 'blur':
      try { (document.activeElement as HTMLElement | null)?.blur?.() } catch { /* ignore */ }
      return true
    case 'closePreview':
      state.setPreviewItemId(null)
      return true
    case 'back':
      if (state.settingsOpen) state.setSettingsOpen(false)
      else if (state.emojiOpen) state.setEmojiOpen(false)
      return true
    case 'close':
      closeShelf()
      return true
    case 'cycleFocus':
      cycleFocus(action.backwards)
      return true
    case 'extend': {
      const from = idAt(action.from)
      const to = idAt(action.index)
      if (!from || !to) return true
      state.extendSelectionTo(from, to, order)
      state.setActiveItemId(to)
      return true
    }
    case 'selectAll':
      state.selectAllVisible(order)
      return true
    case 'clearSelection':
      state.clearSelection()
      return true
    case 'pasteSelection': {
      if (state.previewItemId) state.setPreviewItemId(null)
      const plain = pastePlainFor(state.settings, action.invert, edge.platform)
      tryPaste(() => { void state.pasteSelection(plain, true).catch(() => {}) })
      return true
    }
    case 'copySelection':
      playButtonClickSound()
      void state.copySelection().catch(() => {})
      return true
    case 'deleteSelection':
      playDeleteSound()
      if (state.activeItemId && state.selection.ids.includes(state.activeItemId)) {
        const kept = order.filter((id) => !state.selection.ids.includes(id) || id === state.activeItemId)
        state.setActiveItemId(nextActiveAfterRemoval(kept, state.activeItemId))
      }
      void state.deleteSelection().catch(() => {})
      return true
    case 'pinSelection': {
      const selected = state.items.filter((it) => state.selection.ids.includes(it.id))
      const pinned = !selected.every((it) => it.pinned)
      playToggleSound(pinned)
      void state.pinSelection(pinned).catch(() => {})
      return true
    }
  }
}

export function useKeyboardNav(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const state = useStore.getState()
      if (!state.keyboardMode || !state.open) return
      const order = getNavOrder()
      const action = resolveNavKey(
        {
          key: e.key,
          code: e.code,
          meta: e.metaKey,
          ctrl: e.ctrlKey,
          alt: e.altKey,
          shift: e.shiftKey,
          composing: e.isComposing || e.keyCode === 229
        },
        {
          view: state.settingsOpen ? 'settings' : state.emojiOpen ? 'emoji' : 'list',
          focus: currentFocus(),
          count: order.length,
          active: state.activeItemId ? order.indexOf(state.activeItemId) : -1,
          horizontal: isHorizontalEdge(state.settings.stickPosition),
          rtl: document.documentElement.dir === 'rtl',
          query: state.query,
          previewOpen: !!state.previewItemId,
          selected: state.selection.ids.length
        }
      )
      if (run(action)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useEffect(() => {
    return useStore.subscribe((state, prev) => {
      if (!state.keyboardMode || !state.activeItemId || state.activeItemId === prev.activeItemId) return
      const el = cardElement(state.activeItemId)
      try { el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch { /* ignore */ }
    })
  }, [])
}
