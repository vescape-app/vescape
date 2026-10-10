import { useState } from 'react'
import { ArrowFatLinesUpIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { Markdown } from '@/components/base/Markdown'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme } from '@/constants/theme'
import { DEFAULT_UPDATE_WARNING_MESSAGE } from '@/modules/release/constants/updateWarning'

/** The two dismissible version notices. An App Block is not one — it owns a full-screen shell. */
export type VersionNoticeKind = 'update-warning' | 'online-block'

interface VersionNoticeModalProps {
  kind: VersionNoticeKind
  visible: boolean
  /** Markdown body — the server message or a bundled default. */
  message: string
  onDismiss: () => void
  /** Open the stable platform download route. */
  onUpdate: () => void
  /** The card finished fading out. Lets the caller hand over to the next Release surface. */
  onExited?: () => void
}

const NOTICE = {
  'update-warning': {
    title: 'Update available',
    icon: ArrowFatLinesUpIcon,
    iconColor: theme.status.upgrade.color,
  },
  'online-block': {
    title: 'Update required',
    icon: ArrowFatLinesUpIcon,
    iconColor: theme.status.upgrade.color,
  },
} as const

/**
 * Dismissible version notice: renders the server (or bundled) Markdown message and a single update
 * action. An Update Warning changes no capability availability; an Online Block already denies
 * Online Capabilities natively, so this only tells the rider why. Presentational only;
 * {@link ReleaseSurfaces} decides when it appears and drives dismissal.
 */
export function VersionNoticeModal({
  kind,
  visible,
  message,
  onDismiss,
  onUpdate,
  onExited,
}: VersionNoticeModalProps) {
  // Keep the last shown message so the exit animation renders content instead of blanking.
  const [rendered, setRendered] = useState(DEFAULT_UPDATE_WARNING_MESSAGE)
  if (visible && message !== rendered) setRendered(message)

  const notice = NOTICE[kind]

  return (
    <FadeCardModal
      visible={visible}
      onDismiss={onDismiss}
      title={notice.title}
      titleIcon={notice.icon}
      titleIconColor={notice.iconColor}
      footer={<Button label="Update" variant="tune" onPress={onUpdate} />}
      onExited={onExited}
    >
      <Markdown>{rendered}</Markdown>
    </FadeCardModal>
  )
}
