import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { edge } from '../lib/edge'
import { noteSearchEngaged } from '../lib/searchFocus'
import { useStore } from '../store/appStore'

export function useInputEngagement(inputRef: RefObject<HTMLInputElement | null>) {
  const engagedRef = useRef(false)

  const disengage = useCallback(() => {
    if (!engagedRef.current) return
    engagedRef.current = false
    noteSearchEngaged(false)
    if (!useStore.getState().keyboardMode) {
      try {
        void edge.focusWindow(false)?.catch?.(() => {})
      } catch { /* ignore */ }
    }
    try {
      void edge.pauseHotkey(false)?.catch?.(() => {})
    } catch { /* ignore */ }
  }, [])

  const engage = useCallback(() => {
    if (engagedRef.current) return
    engagedRef.current = true
    noteSearchEngaged(true)
    const focusInput = () => {
      try { inputRef.current?.focus() } catch { /* ignore */ }
    }
    try {
      window.focus()
    } catch { /* ignore */ }
    if (useStore.getState().keyboardMode) {
      focusInput()
    } else {
      try {
        const p: Promise<void> | undefined = edge.focusWindow(true)
        if (p && typeof p.then === 'function') {
          p.then(focusInput).catch(() => {})
        } else {
          focusInput()
        }
      } catch { /* ignore */ }
    }
    try {
      void edge.pauseHotkey(true)?.catch?.(() => {})
    } catch { /* ignore */ }
  }, [inputRef])

  useEffect(() => () => {
    disengage()
  }, [disengage])

  return { engage, disengage }
}
