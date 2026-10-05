import { playEdgeRetractSound, playEdgeBeaconAppearSound, playEdgeExpandSound, playButtonClickSound } from '../lib/soundEffects'
import { selectReduceMotion } from './storeHelpers'
import type { AppState, StoreGet, StoreSet } from './types'

export const createEdgeTransitionSlice = (set: StoreSet, get: StoreGet) => ({
  sliderActive: false,
  sliderReleasedTime: 0,
  setSliderActive: (active) => set({
    sliderActive: active,
    sliderReleasedTime: active ? 0 : Date.now()
  }),
  notifyPositionChanged: () => set({ sliderReleasedTime: Date.now() }),
  resetPositionChangedTime: () => {
    if (get().sliderReleasedTime !== 0) set({ sliderReleasedTime: 0 })
  },
  edgeHintActive: false,
  setEdgeHintActive: (active) => {
    if (get().edgeHintActive !== active) set({ edgeHintActive: active })
  },

  edgeTransition: null,
  async startEdgeTransition(to) {
    if (get().edgeTransition?.active) return
    const current = (get().settings.stickPosition || 'left') as 'left' | 'right' | 'top'
    if (current === to) return

    const reduceMotion = selectReduceMotion(get())

    if (reduceMotion) {
      playButtonClickSound()
      set({ settingsTab: 'position' })
      await get().patchSettings({ stickPosition: to })
      get().notifyPositionChanged()
      return
    }

    // 1. Edge-drop retracts into the bar (260ms)
    playEdgeRetractSound()
    set({
      edgeTransition: {
        active: true,
        from: current,
        to,
        stage: 'retracting'
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 260))

    // 2. Edge bar instantly fades away (100ms)
    set({
      edgeTransition: {
        active: true,
        from: current,
        to,
        stage: 'bar_fade_out'
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    // 3. Reposition window & patch settings to selected edge while invisible
    await get().patchSettings({ stickPosition: to })
    get().notifyPositionChanged()
    await new Promise((resolve) => setTimeout(resolve, 30))

    // 4. In selected edge, edge bar fades in (120ms)
    playEdgeBeaconAppearSound()
    set({
      settingsTab: 'position',
      edgeTransition: {
        active: true,
        from: current,
        to,
        stage: 'bar_fade_in'
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 120))

    // 5. Clipboard expands from the bar (300ms)
    playEdgeExpandSound()
    set({
      edgeTransition: {
        active: true,
        from: current,
        to,
        stage: 'expanding'
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 300))

    // 6. Reset transition state & start stay window from expansion completion
    set({ edgeTransition: null })
    get().notifyPositionChanged()
  }
}) satisfies Partial<AppState>
