import { useState, useEffect } from 'react'
import { useStore } from '../../store/appStore'
import { tryPaste } from '../../lib/tryPaste'
import { playButtonClickSound, playToggleSound } from '../../lib/soundEffects'
import type { ClipboardItemDto } from '../../../shared/types'

function getItemKeys(item: any): string[] {
  if (!item) return []
  if (item.data.kind === 'files') {
    return item.data.paths || []
  }
  if (item.data.kind === 'image-collection') {
    return (item.data.images || []).map((img: any) => img.imageId)
  }
  return []
}

export function usePreviewSelection(item: ClipboardItemDto | null | undefined) {
  // ── Multi-selection state (Option 1: Tap-to-toggle) ────────────────────────
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  // Reset selection whenever preview item changes or closes
  useEffect(() => {
    setSelectedKeys(new Set())
  }, [item?.id])

  const toggleSelectKey = (key: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    playToggleSound(true)
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const allItemKeys = getItemKeys(item)

  const handleSelectAllToggle = () => {
    playButtonClickSound()
    if (selectedKeys.size === allItemKeys.length) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(allItemKeys))
    }
  }

  const handleBatchCopy = () => {
    if (!item || selectedKeys.size === 0) return
    playButtonClickSound()
    const keys = Array.from(selectedKeys)
    if (item.data.kind === 'files') {
      useStore.getState().copySubitem({ id: item.id, paths: keys })
    } else if (item.data.kind === 'image-collection') {
      if (keys.length === 1) {
        useStore.getState().copySubitem({ id: item.id, imageId: keys[0] })
      } else {
        useStore.getState().copy(item.id)
      }
    }
  }

  const handleBatchPaste = () => {
    if (!item || selectedKeys.size === 0) return
    playButtonClickSound()
    const keys = Array.from(selectedKeys)
    if (item.data.kind === 'files') {
      tryPaste(() => window.edge.pasteSubitem({ id: item.id, paths: keys }))
    } else if (item.data.kind === 'image-collection') {
      if (keys.length === 1) {
        tryPaste(() => window.edge.pasteSubitem({ id: item.id, imageId: keys[0] }))
      } else {
        tryPaste(() => useStore.getState().paste(item.id))
      }
    }
  }

  return { selectedKeys, setSelectedKeys, toggleSelectKey, allItemKeys, handleSelectAllToggle, handleBatchCopy, handleBatchPaste }
}
