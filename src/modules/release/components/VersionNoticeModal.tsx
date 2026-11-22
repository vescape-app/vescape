import { useState } from 'react'
import { ArrowFatLinesUpIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { Markdown } from '@/components/base/Markdown'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme } from '@/constants/theme'
import { DEFAULT_UPDATE_WARNING_MESSAGE } from '@/modules/release/constants/updateWarning'

export type VersionNoticeKind = 'update-warning' | 'online-block'

interface VersionNoticeModalProps {
  kind: VersionNoticeKind
  visible: boolean
  message: string
  onDismiss: () => void
  onUpdate: () => void
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

export function VersionNoticeModal({
  kind,
  visible,
  message,
  onDismiss,
  onUpdate,
  onExited,
}: VersionNoticeModalProps) {
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
