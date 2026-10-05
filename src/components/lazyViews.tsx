import { useEffect, useSyncExternalStore, type ComponentType } from 'react'
import './WakeSlider.css'
import '../styles/settings.css'

interface LazyView<P extends object> {
  View: ComponentType<P>
  preload: () => Promise<void>
}

function lazyView<P extends object>(load: () => Promise<ComponentType<P>>, loadOnMount = false): LazyView<P> {
  let loaded: ComponentType<P> | null = null
  let pending: Promise<void> | null = null
  const listeners = new Set<() => void>()

  const preload = (): Promise<void> => {
    if (!pending) {
      pending = load()
        .then((component) => {
          loaded = component
          listeners.forEach((listener) => listener())
        })
        .catch(() => {
          pending = null
        })
    }
    return pending
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const getLoaded = (): ComponentType<P> | null => loaded

  function View(props: P) {
    const Component = useSyncExternalStore(subscribe, getLoaded)
    useEffect(() => {
      if (loadOnMount && !Component) void preload()
    }, [Component])
    return Component ? <Component {...props} /> : null
  }

  return { View, preload }
}

const settingsView = lazyView(() => import('./Settings').then((m) => m.Settings), true)
const previewFlyoutView = lazyView(() => import('./PreviewFlyout').then((m) => m.PreviewFlyout))

export const Settings = settingsView.View
export const PreviewFlyout = previewFlyoutView.View

export function preloadLazyViews(): void {
  void settingsView.preload()
  void previewFlyoutView.preload()
}
