import { useStore } from '../../store/appStore'
import { useTranslation } from '../../i18n'
import { ToggleCard } from './layout'

export function CaptureScreenshotsCard() {
  const { t } = useTranslation()
  const captureScreenshots = useStore((s) => s.settings.captureScreenshots)
  const patch = useStore((s) => s.patchSettings)
  return (
    <ToggleCard
      id="captureScreenshots"
      kind="incognito-card"
      col="behaviour-col"
      group={t('groups.privacy') || 'PRIVACY'}
      title={t('behaviour.captureScreenshotsTitle')}
      desc={t('behaviour.captureScreenshotsDesc')}
      checked={captureScreenshots !== false}
      onChange={(v) => patch({ captureScreenshots: v })}
    />
  )
}

export function HideFromCaptureCard() {
  const { t } = useTranslation()
  const hideFromScreenCapture = useStore((s) => s.settings.hideFromScreenCapture)
  const patch = useStore((s) => s.patchSettings)
  return (
    <ToggleCard
      id="hideFromScreenCapture"
      kind="incognito-card"
      col="behaviour-col"
      group={t('groups.privacy') || 'PRIVACY'}
      title={t('behaviour.hideFromCaptureTitle')}
      desc={t('behaviour.hideFromCaptureDesc')}
      checked={!!hideFromScreenCapture}
      onChange={(v) => patch({ hideFromScreenCapture: v })}
    />
  )
}

export function IgnoreRemoteCard() {
  const { t } = useTranslation()
  const ignoreRemoteClipboard = useStore((s) => s.settings.ignoreRemoteClipboard)
  const patch = useStore((s) => s.patchSettings)
  return (
    <ToggleCard
      id="ignoreRemoteClipboard"
      kind="incognito-card"
      col="behaviour-col"
      group={t('groups.privacy') || 'PRIVACY'}
      title={t('behaviour.ignoreRemoteTitle')}
      desc={t('behaviour.ignoreRemoteDesc')}
      checked={!!ignoreRemoteClipboard}
      onChange={(v) => patch({ ignoreRemoteClipboard: v })}
    />
  )
}

export function PastePlainCard() {
  const { t } = useTranslation()
  const pastePlainText = useStore((s) => s.settings.pastePlainText)
  const patch = useStore((s) => s.patchSettings)
  return (
    <ToggleCard
      id="pastePlainText"
      kind="order-card"
      col="behaviour-col"
      group={t('groups.clipboardBehaviour') || 'CLIPBOARD BEHAVIOUR'}
      title={t('behaviour.pastePlainTitle')}
      desc={t('behaviour.pastePlainDesc')}
      checked={!!pastePlainText}
      onChange={(v) => patch({ pastePlainText: v })}
    />
  )
}

export function RecognizeTextCard() {
  const { t } = useTranslation()
  const recognizeImageText = useStore((s) => s.settings.recognizeImageText)
  const patch = useStore((s) => s.patchSettings)
  return (
    <ToggleCard
      id="recognizeImageText"
      kind="order-card"
      col="behaviour-col"
      group={t('groups.clipboardBehaviour') || 'CLIPBOARD BEHAVIOUR'}
      title={t('behaviour.recognizeTextTitle')}
      desc={t('behaviour.recognizeTextDesc')}
      checked={recognizeImageText !== false}
      onChange={(v) => patch({ recognizeImageText: v })}
    />
  )
}
