import { useEffect, useState, useRef, useLayoutEffect } from 'react'
import { useStore, selectReduceMotion } from '../../store/appStore'
import type { DisplayInfo } from '../../../shared/types'
import { resolveUpdateMode } from '../../../shared/types'
import { resolvePanelWidth } from '../../hooks/useEdgeHover'
import { displayedUpdateMode } from './updateMode'
import { useSettingsLayout, type SettingsTab } from './layout'
import { useAccessibilityStatus } from './AccessibilityCard'
import { useIgnoredApps } from './IgnoredAppsCard'
import { playDialTickSound, playButtonClickSound } from '../../lib/soundEffects'
import { useTranslation } from '../../i18n'
import { IS_DARWIN } from '../../lib/edge'

export function useSettingsState(inlineIndicatorStyle?: boolean) {
  const { t, language, languages } = useTranslation()
  const settings = useStore((s) => s.settings)
  const { isHorizontal, titleId, cardClass } = useSettingsLayout()

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: 'behaviour',  label: t('tabs.behaviour') },
    { id: 'position',   label: t('tabs.position') },
    { id: 'appearance', label: t('tabs.appearance') },
  ]
  const patch = useStore((s) => s.patchSettings)
  const updateInfo = useStore((s) => s.updateInfo)
  const isStoreBuild = useStore((s) => s.isStoreBuild)
  const currentVersion = useStore((s) => s.currentVersion)
  const reduceMotion = useStore(selectReduceMotion)
  const styleFlyoutOpen = useStore((s) => s.styleFlyoutOpen)
  const setStyleFlyoutOpen = useStore((s) => s.setStyleFlyoutOpen)
  const languageFlyoutOpen = useStore((s) => s.languageFlyoutOpen)
  const setLanguageFlyoutOpen = useStore((s) => s.setLanguageFlyoutOpen)
  const setSliderActive = useStore((s) => s.setSliderActive)
  const edgeTransition = useStore((s) => s.edgeTransition)
  const startEdgeTransition = useStore((s) => s.startEdgeTransition)

  const selectedLang = languages.find((l) => l.code === (language || 'system')) || languages[0]

  const lastTickVal = useRef<number>(settings.verticalOffset ?? 0.5)
  const horizontalTab = useStore((s) => s.settingsTab)
  const shelfTrackRef = useRef<HTMLDivElement>(null)
  const horizontalTabScrollPositions = useRef<Record<SettingsTab, number>>({
    behaviour: 0,
    position: 0,
    appearance: 0
  })
  const isSwitchingTabRef = useRef(false)

  // Reset horizontal tab to 'behaviour' and scroll positions to 0 on mount,
  // but preserve 'position' if already on it or actively transitioning edges.
  useEffect(() => {
    if (isHorizontal) {
      const currentTab = useStore.getState().settingsTab
      const isTransitioning = !!useStore.getState().edgeTransition?.active
      if (currentTab !== 'position' && !isTransitioning) {
        useStore.getState().setSettingsTab('behaviour')
      }
      horizontalTabScrollPositions.current = {
        behaviour: 0,
        position: 0,
        appearance: 0
      }
    }
  }, [isHorizontal])

  // Restore target section's independent horizontal scroll position when tab changes
  useLayoutEffect(() => {
    if (!isHorizontal) return
    isSwitchingTabRef.current = true
    if (shelfTrackRef.current) {
      const targetPos = horizontalTabScrollPositions.current[horizontalTab] ?? 0
      shelfTrackRef.current.scrollLeft = targetPos
    }
    const id = requestAnimationFrame(() => {
      isSwitchingTabRef.current = false
    })
    return () => cancelAnimationFrame(id)
  }, [isHorizontal, horizontalTab])

  const handleSliderInput = (rawVal: number) => {
    const clamped = Math.min(1.0, Math.max(0.0, rawVal))
    if (Math.abs(clamped - lastTickVal.current) >= 0.05) {
      lastTickVal.current = clamped
      playDialTickSound()
    }
    useStore.setState((s) => ({
      settings: { ...s.settings, verticalOffset: clamped }
    }))
  }

  const handleSliderRelease = (rawVal: number) => {
    const snapped = Math.round(rawVal / 0.05) * 0.05
    const clamped = Math.min(1.0, Math.max(0.0, snapped))
    lastTickVal.current = clamped
    playDialTickSound()
    patch({ verticalOffset: clamped })
  }

  const handleThicknessInput = (rawVal: number) => {
    const clamped = Math.min(7, Math.max(1, Math.round(rawVal)))
    if (clamped !== (settings.hotZoneWidth ?? 3)) {
      playDialTickSound()
      useStore.setState((s) => ({
        settings: { ...s.settings, hotZoneWidth: clamped }
      }))
    }
  }

  const handleThicknessRelease = (rawVal: number) => {
    const clamped = Math.min(7, Math.max(1, Math.round(rawVal)))
    setSliderActive(false)
    playDialTickSound()
    patch({ hotZoneWidth: clamped })
  }

  const handlePanelWidthInput = (rawVal: number) => {
    const next = resolvePanelWidth({ panelWidth: rawVal, stickPosition: settings.stickPosition })
    if (next !== resolvePanelWidth(settings)) {
      playDialTickSound()
      useStore.setState((s) => ({
        settings: { ...s.settings, panelWidth: next }
      }))
    }
  }

  const handlePanelWidthRelease = (rawVal: number) => {
    const next = resolvePanelWidth({ panelWidth: rawVal, stickPosition: settings.stickPosition })
    setSliderActive(false)
    playDialTickSound()
    patch({ panelWidth: next })
  }

  const [localInlineOpen, setLocalInlineOpen] = useState(false)
  const isTutorial = inlineIndicatorStyle || (typeof window !== 'undefined' && window.location.hash.includes('onboarding'))
  const isFlyoutActive = isTutorial ? localInlineOpen : styleFlyoutOpen
  const indicatorBtnRef = useRef<HTMLButtonElement | null>(null)

  const handleToggleFlyout = (anchorEl?: HTMLElement | null) => {
    if (isTutorial) {
      setLocalInlineOpen(!localInlineOpen)
    } else {
      const nextOpen = !styleFlyoutOpen
      let rect: { x: number; y: number; width: number; height: number } | null = null
      if (nextOpen && anchorEl) {
        const r = anchorEl.getBoundingClientRect()
        rect = { x: r.left, y: r.top, width: r.width, height: r.height }
      }
      setStyleFlyoutOpen(nextOpen, rect)
    }
  }

  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  useEffect(() => {
    if (IS_DARWIN) return
    const timer = window.setTimeout(() => {
      window.edge.getDisplays().then(setDisplays).catch(() => {})
    }, 250)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    let timer: number
    const pullTimer = window.setTimeout(() => {
      void useStore.getState().refreshLaunchAtLogin()
      timer = window.setInterval(() => {
        void useStore.getState().refreshLaunchAtLogin()
      }, 2000)
    }, 300)
    return () => {
      window.clearTimeout(pullTimer)
      if (timer) window.clearInterval(timer)
    }
  }, [])

  const accessibility = useAccessibilityStatus()

  const ignoredApps = useIgnoredApps()

  const updateDownloaded = updateInfo?.downloaded ? { version: updateInfo.latestVersion } : null
  const updateMode = resolveUpdateMode(settings)
  const shownUpdateMode = displayedUpdateMode(updateMode, IS_DARWIN)

  const checkState = useStore((s) => s.manualCheckState)
  const handleManualCheck = () => useStore.getState().startManualCheck()
  const handleStartDownload = () => {
    void useStore.getState().startManualDownload()
  }

  const isManualDownloading = checkState.status === 'downloading'
  const isDownloading = isManualDownloading || (!updateDownloaded && !!updateInfo?.hasUpdate && (shownUpdateMode === 'auto' || !!updateInfo?.downloadProgress))
  // Update waiting for a user decision (Notify mode prompt or available check).
  const hasBackgroundUpdate = !updateDownloaded && !isDownloading && (!!updateInfo?.hasUpdate || checkState.status === 'available')
  const downloadPercent = updateInfo?.downloadProgress?.percent ?? 0

  // ── Tab state & Independent Scroll Memory per section ──────────────────────
  const activeTab = useStore((s) => s.settingsTab)
  const setActiveTab = useStore((s) => s.setSettingsTab)
  const scrollListRef = useRef<HTMLDivElement>(null)
  const tabScrollPositions = useRef<Record<SettingsTab, number>>({
    behaviour: 0,
    position: 0,
    appearance: 0
  })

  const handleTabSwitch = (newTab: SettingsTab) => {
    if (newTab === activeTab) return
    if (styleFlyoutOpen) {
      setStyleFlyoutOpen(false)
    }
    // Save current section's scroll position
    if (scrollListRef.current) {
      tabScrollPositions.current[activeTab] = scrollListRef.current.scrollTop
    }
    playButtonClickSound()
    setActiveTab(newTab)
  }

  // Close flyout if settings closes or unmounts
  useEffect(() => {
    return () => {
      if (useStore.getState().styleFlyoutOpen) {
        useStore.getState().setStyleFlyoutOpen(false)
      }
    }
  }, [])

  // Restore target section's independent scroll position when tab changes
  useEffect(() => {
    if (scrollListRef.current) {
      const targetPos = tabScrollPositions.current[activeTab] ?? 0
      scrollListRef.current.scrollTop = targetPos
    }
  }, [activeTab])

  // When update check finds a new update, smoothly scroll to top/front to highlight the update card
  useEffect(() => {
    if (checkState.status === 'available') {
      const behavior = reduceMotion ? 'auto' : 'smooth'
      if (isHorizontal) {
        if (shelfTrackRef.current) {
          shelfTrackRef.current.scrollTo({ left: 0, behavior })
        }
        horizontalTabScrollPositions.current.behaviour = 0
      } else {
        if (scrollListRef.current) {
          scrollListRef.current.scrollTo({ top: 0, behavior })
        }
        tabScrollPositions.current.behaviour = 0
      }
    }
  }, [checkState.status, isHorizontal, reduceMotion])

  // ── Promoted Active Update State ───────────────────────────────────────────
  // The top card shows all active update lifecycle stages:
  // 1) Downloaded update -> 'Restart to Update'
  // 2) Downloading in progress -> Live progress bar
  // 3) Update found & available -> 'Download & Update' / 'Skip'
  const hasPromotedTopUpdate = !isStoreBuild && (
    !!updateDownloaded ||
    isDownloading ||
    hasBackgroundUpdate
  )
  const updateBannerRef = useRef<HTMLDivElement | null>(null)

  return {
    t,
    settings,
    isHorizontal,
    titleId,
    cardClass,
    TABS,
    patch,
    updateInfo,
    isStoreBuild,
    currentVersion,
    styleFlyoutOpen,
    setStyleFlyoutOpen,
    languageFlyoutOpen,
    setLanguageFlyoutOpen,
    setSliderActive,
    edgeTransition,
    startEdgeTransition,
    selectedLang,
    horizontalTab,
    shelfTrackRef,
    horizontalTabScrollPositions,
    isSwitchingTabRef,
    handleSliderInput,
    handleSliderRelease,
    handleThicknessInput,
    handleThicknessRelease,
    handlePanelWidthInput,
    handlePanelWidthRelease,
    localInlineOpen,
    isTutorial,
    isFlyoutActive,
    indicatorBtnRef,
    handleToggleFlyout,
    displays,
    accessibility,
    ignoredApps,
    updateDownloaded,
    shownUpdateMode,
    checkState,
    handleManualCheck,
    handleStartDownload,
    isDownloading,
    hasBackgroundUpdate,
    downloadPercent,
    activeTab,
    scrollListRef,
    handleTabSwitch,
    hasPromotedTopUpdate,
    updateBannerRef
  }
}

export type SettingsState = ReturnType<typeof useSettingsState>
