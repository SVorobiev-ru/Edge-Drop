import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/appStore'
import type { AppInfo } from '../../../shared/types'
import { CloseIcon } from '../icons'
import { IS_DARWIN } from '../../lib/edge'
import { playButtonClickSound } from '../../lib/soundEffects'
import { useTranslation } from '../../i18n'
import { useSettingsLayout } from './layout'

export function useIgnoredApps() {
  const settings = useStore((s) => s.settings)
  const patch = useStore((s) => s.patchSettings)
  const ignoredApps = settings.ignoredApps ?? []
  const [runningApps, setRunningApps] = useState<AppInfo[]>([])
  const [knownApps, setKnownApps] = useState<Record<string, AppInfo>>({})
  const [appIcons, setAppIcons] = useState<Record<string, string | null>>({})
  const [appChooserOpen, setAppChooserOpen] = useState(false)
  const appChooserRef = useRef<HTMLDivElement | null>(null)

  const rememberApps = (apps: AppInfo[]) => {
    if (apps.length === 0) return
    setKnownApps((prev) => {
      const next = { ...prev }
      for (const app of apps) next[app.bundleId] = app
      return next
    })
  }

  const refreshRunningApps = () => {
    Promise.resolve()
      .then(() => window.edge.listRunningApps())
      .then((apps) => {
        const list = Array.isArray(apps) ? apps : []
        setRunningApps(list)
        rememberApps(list)
      })
      .catch(() => {})
  }

  useEffect(() => {
    if (IS_DARWIN) refreshRunningApps()
  }, [])

  const ignoredAppsKey = ignoredApps.join('\n')
  useEffect(() => {
    if (!IS_DARWIN) return
    let cancelled = false
    for (const bundleId of ignoredApps) {
      if (bundleId in appIcons) continue
      Promise.resolve()
        .then(() => window.edge.getAppIcon(bundleId))
        .then((icon) => {
          if (!cancelled) setAppIcons((prev) => ({ ...prev, [bundleId]: icon ?? null }))
        })
        .catch(() => {
          if (!cancelled) setAppIcons((prev) => ({ ...prev, [bundleId]: null }))
        })
    }
    return () => {
      cancelled = true
    }
  }, [ignoredAppsKey])

  useEffect(() => {
    if (!appChooserOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (appChooserRef.current && !appChooserRef.current.contains(e.target as Node)) {
        setAppChooserOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [appChooserOpen])

  const addIgnoredApp = (app: AppInfo) => {
    playButtonClickSound()
    rememberApps([app])
    setAppChooserOpen(false)
    if (ignoredApps.includes(app.bundleId)) return
    patch({ ignoredApps: [...ignoredApps, app.bundleId] })
  }

  const removeIgnoredApp = (bundleId: string) => {
    playButtonClickSound()
    patch({ ignoredApps: ignoredApps.filter((id) => id !== bundleId) })
  }

  const handlePickApp = async () => {
    playButtonClickSound()
    setAppChooserOpen(false)
    try {
      const app = await window.edge.pickApp()
      if (app) addIgnoredApp(app)
    } catch {
      /* ignore */
    }
  }

  return {
    ignoredApps,
    runningApps,
    knownApps,
    appIcons,
    appChooserOpen,
    setAppChooserOpen,
    appChooserRef,
    refreshRunningApps,
    addIgnoredApp,
    removeIgnoredApp,
    handlePickApp
  }
}

export function IgnoredAppsCard({
  ignoredApps,
  runningApps,
  knownApps,
  appIcons,
  appChooserOpen,
  setAppChooserOpen,
  appChooserRef,
  refreshRunningApps,
  addIgnoredApp,
  removeIgnoredApp,
  handlePickApp
}: ReturnType<typeof useIgnoredApps>) {
  const { t } = useTranslation()
  const { titleId, cardClass } = useSettingsLayout()
  const chooserApps = runningApps.filter((app) => !ignoredApps.includes(app.bundleId))
  const appIcon = (bundleId: string) => appIcons[bundleId] || knownApps[bundleId]?.icon || null
  return (
    <div className={cardClass('ignored-apps-card', 'behaviour-col')}>
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.privacy') || 'PRIVACY'}</div>
        <div className="setting-title" id={titleId('ignoredApps')}>{t('behaviour.ignoredAppsTitle')}</div>
        <div className="setting-desc">{t('behaviour.ignoredAppsDesc')}</div>
      </div>
      <div className="shelf-card-bottom">
        <ul className="ignored-apps-list" aria-labelledby={titleId('ignoredApps')}>
          {ignoredApps.length === 0 ? (
            <li className="ignored-apps-empty">{t('behaviour.ignoredAppsEmpty')}</li>
          ) : (
            ignoredApps.map((bundleId) => {
              const name = knownApps[bundleId]?.name || bundleId
              const icon = appIcon(bundleId)
              return (
                <li key={bundleId} className="ignored-app-row">
                  {icon ? (
                    <img className="ignored-app-icon" src={icon} alt="" />
                  ) : (
                    <span className="ignored-app-icon placeholder" aria-hidden="true" />
                  )}
                  <span className="ignored-app-name" title={bundleId}>{name}</span>
                  <button
                    type="button"
                    className="ignored-app-remove"
                    title={t('behaviour.ignoredAppsRemove')}
                    aria-label={`${t('behaviour.ignoredAppsRemove')}: ${name}`}
                    onClick={() => removeIgnoredApp(bundleId)}
                  >
                    <CloseIcon width={10} height={10} />
                  </button>
                </li>
              )
            })
          )}
        </ul>
        <div className="ignored-apps-add-wrap" ref={appChooserRef}>
          <button
            type="button"
            className="pill display-pill"
            style={{ width: '100%', justifyContent: 'center' }}
            aria-expanded={appChooserOpen}
            onClick={() => {
              playButtonClickSound()
              if (!appChooserOpen) refreshRunningApps()
              setAppChooserOpen(!appChooserOpen)
            }}
          >
            {t('behaviour.ignoredAppsAdd')}
          </button>
          {appChooserOpen && (
            <div className="ignored-apps-chooser">
              {chooserApps.map((app) => {
                const icon = app.icon || appIcons[app.bundleId] || null
                return (
                  <button
                    key={app.bundleId}
                    type="button"
                    className="ignored-apps-chooser-item"
                    title={app.bundleId}
                    onClick={() => addIgnoredApp(app)}
                  >
                    {icon ? (
                      <img className="ignored-app-icon" src={icon} alt="" />
                    ) : (
                      <span className="ignored-app-icon placeholder" aria-hidden="true" />
                    )}
                    <span className="ignored-app-name">{app.name || app.bundleId}</span>
                  </button>
                )
              })}
              <button
                type="button"
                className="ignored-apps-chooser-item other"
                onClick={() => {
                  void handlePickApp()
                }}
              >
                <span className="ignored-app-name">{t('behaviour.ignoredAppsChooseOther')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
