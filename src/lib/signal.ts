import { useSyncExternalStore } from 'react'

export interface Signal {
  subscribe: (fn: () => void) => () => void
  emit: () => void
}

export function createSignal(): Signal {
  const listeners = new Set<() => void>()
  return {
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    emit() {
      listeners.forEach((fn) => fn())
    }
  }
}

export function useSignalValue<T>(signal: Signal, read: () => T, serverValue: () => T): T {
  return useSyncExternalStore(signal.subscribe, read, serverValue)
}
