import { useStore } from '../../store/appStore'
import { DEFAULT_PASTE_QUEUE_HOTKEY, defaultToggleHotkey } from '../../../shared/types'
import { HotkeyRecorder } from '../HotkeyRecorder'
import { IS_DARWIN } from '../../lib/edge'
import { useTranslation } from '../../i18n'
import { hotkeyFailureMessageKey, sameMacAccelerator } from './hotkeys'
import { useSettingsLayout } from './layout'

export const PLATFORM_TOGGLE_HOTKEY = defaultToggleHotkey(IS_DARWIN)

function HotkeyCard({
  id,
  title,
  desc,
  hotkey,
  defaultHotkey,
  onChange
}: {
  id: string
  title: string
  desc: string
  hotkey: string
  defaultHotkey: string
  onChange: (next: string) => void
}) {
  const { t } = useTranslation()
  const { titleId, cardClass } = useSettingsLayout()
  const pushToast = useStore((s) => s.pushToast)

  const handleHotkeyRejected = () => {
    pushToast({
      id: Date.now().toString(),
      message: t('toast.shortcutReserved'),
      tone: 'error'
    })
  }

  return (
    <div className={cardClass('hotkey-card', 'behaviour-col')}>
      <div className="shelf-card-top">
        <div className="setting-group-label">{t('groups.keyboardShortcut') || 'KEYBOARD SHORTCUT'}</div>
        <div className="setting-title" id={titleId(id)}>{title}</div>
        <div className="setting-desc">{desc}</div>
      </div>
      <div className="shelf-card-bottom">
        <HotkeyRecorder
          hotkey={hotkey}
          defaultHotkey={defaultHotkey}
          onChange={onChange}
          onReject={handleHotkeyRejected}
        />
        {IS_DARWIN && <div className="setting-desc hotkey-conflict-hint">{t('behaviour.hotkeyConflictHint')}</div>}
      </div>
    </div>
  )
}

// Card 5: Global Toggle Shortcut
export function ToggleHotkeyCard() {
  const { t } = useTranslation()
  const { isHorizontal } = useSettingsLayout()
  const settings = useStore((s) => s.settings)
  const pushToast = useStore((s) => s.pushToast)

  const handleToggleHotkeyChange = async (nextHotkey: string) => {
    const shortcutToast = () =>
      pushToast({
        id: Date.now().toString(),
        message: t('toast.shortcutUpdated', { shortcut: nextHotkey }),
        tone: 'info'
      })
    let result: Awaited<ReturnType<typeof window.edge.setHotkey>>
    try {
      result = await window.edge.setHotkey(nextHotkey)
    } catch {
      pushToast({
        id: Date.now().toString(),
        message: t('toast.shortcutTaken'),
        tone: 'error'
      })
      return
    }
    if (result?.settings) useStore.getState().setSettings(result.settings)
    if (!result?.ok) {
      pushToast({
        id: Date.now().toString(),
        message: t(hotkeyFailureMessageKey(result?.reason)),
        tone: 'error'
      })
      return
    }
    shortcutToast()
  }

  return (
    <HotkeyCard
      id="toggleHotkey"
      title={t('behaviour.toggleHotkeyTitle')}
      desc={isHorizontal ? (t('groups.toggleHotkeyPressDesc') || 'Press anywhere to toggle Edge-Drop') : t('behaviour.toggleHotkeyDesc')}
      hotkey={settings.toggleHotkey || PLATFORM_TOGGLE_HOTKEY}
      defaultHotkey={PLATFORM_TOGGLE_HOTKEY}
      onChange={(nextHotkey) => {
        void handleToggleHotkeyChange(nextHotkey)
      }}
    />
  )
}

export function PasteQueueHotkeyCard() {
  const { t } = useTranslation()
  const settings = useStore((s) => s.settings)
  const patch = useStore((s) => s.patchSettings)
  const pushToast = useStore((s) => s.pushToast)

  const handlePasteQueueHotkeyChange = (nextHotkey: string) => {
    if (sameMacAccelerator(nextHotkey, settings.toggleHotkey || PLATFORM_TOGGLE_HOTKEY)) {
      pushToast({
        id: Date.now().toString(),
        message: t('toast.shortcutTaken'),
        tone: 'error'
      })
      return
    }
    patch({ pasteQueueHotkey: nextHotkey })
    pushToast({
      id: Date.now().toString(),
      message: t('toast.shortcutUpdated', { shortcut: nextHotkey }),
      tone: 'info'
    })
  }

  return (
    <HotkeyCard
      id="pasteQueueHotkey"
      title={t('behaviour.pasteQueueTitle')}
      desc={t('behaviour.pasteQueueDesc')}
      hotkey={settings.pasteQueueHotkey || DEFAULT_PASTE_QUEUE_HOTKEY}
      defaultHotkey={DEFAULT_PASTE_QUEUE_HOTKEY}
      onChange={handlePasteQueueHotkeyChange}
    />
  )
}
