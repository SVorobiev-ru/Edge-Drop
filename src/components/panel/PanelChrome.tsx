import { useEffect, useLayoutEffect, useRef } from 'react'
import { panelResizeGripProps, releasePanelCursor } from '../../hooks/usePanelResize'
import { resizeGripStyle, type MorphPhase } from '../../lib/panelPosition'
import type { ResizeSide } from '../../../shared/panelPlacement'
import type { StickPosition } from '../../../shared/types'

export function PanelResizeGrip({ side, stick }: { side: ResizeSide; stick: StickPosition }) {
  const { cursor, ...handlers } = panelResizeGripProps(side, stick)
  useEffect(() => releasePanelCursor, [])
  return (
    <div
      className="panel-resize-handle"
      aria-hidden="true"
      {...handlers}
      style={{ position: 'absolute', zIndex: 300, cursor, ...resizeGripStyle(side, stick) }}
    />
  )
}

export function PanelMorphShell({ phase }: { phase: MorphPhase }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    ref.current?.getBoundingClientRect()
  }, [])
  return <div ref={ref} className={`panel-morph-shell${phase === 'reveal' ? ' is-revealing' : ''}`} aria-hidden="true" />
}
