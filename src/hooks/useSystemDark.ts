import { useEffect, useState } from 'react'
import { IS_DARWIN } from '../lib/edge'

export function useSystemDark(initialDark: boolean | (() => boolean)): boolean {
  const [systemDark, setSystemDark] = useState(initialDark)

  useEffect(() => {
    if (!IS_DARWIN || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setSystemDark(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return systemDark
}
