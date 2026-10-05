import { describe, expect, it } from 'vitest'
import { readClipboardItemSource } from './helpers/splitSources'

describe('card store subscriptions', () => {
  const card = readClipboardItemSource()

  it('does not subscribe to the whole settings object or shared ids', () => {
    expect(card).not.toMatch(/useStore\(\(s\) => s\.settings\)/)
    expect(card).not.toMatch(/useStore\(\(s\) => s\.expandedStackId\)/)
    expect(card).not.toMatch(/useStore\(\(s\) => s\.previewItemId\)/)
  })

  it('selects primitives scoped to the card', () => {
    expect(card).toContain('useStore((s) => isHorizontalEdge(s.settings.stickPosition))')
    expect(card).toContain('useStore((s) => s.expandedStackId === item.id)')
    expect(card).toContain('useStore((s) => s.previewItemId === item.id)')
  })

  it('looks up selection and queue state per card in constant time', () => {
    expect(card).toContain('s.selectedMap[item.id]')
    expect(card).toContain('s.queueIndex[item.id] ?? -1')
    expect(card).not.toContain('s.selection.ids.includes(item.id)')
    expect(card).not.toContain('s.queueIds.indexOf(item.id)')
  })

  it('keeps the Windows card behaviour: no focus stop, buttons drop focus after a click', () => {
    expect(card).toContain("role={IS_DARWIN ? 'button' : undefined}")
    expect(card).toContain('tabIndex={IS_DARWIN ? 0 : undefined}')
    expect(card).toContain('if (!IS_DARWIN) e.currentTarget.blur()')
  })

  it('drops focus through releaseFocus from more than one card button', () => {
    expect(card).toContain('function releaseFocus(e: React.MouseEvent<HTMLElement>): void {')
    expect(card.match(/\breleaseFocus\(e\)/g)!.length).toBeGreaterThan(1)
  })

  it('builds badges from translation keys without slicing strings', () => {
    expect(card).not.toContain('.slice(0, -1)')
    expect(card).not.toContain('>color</span>')
  })
})
