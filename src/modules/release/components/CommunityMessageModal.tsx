import { useState } from 'react'
import { InfoIcon, WarningIcon, WarningOctagonIcon, type Icon } from 'phosphor-react-native'

import type { CommunityMessage, CommunityMessageAction, CommunityMessageType } from 'vescape-core'
import { Button } from '@/components/base/Button'
import { Markdown } from '@/components/base/Markdown'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme, type ThemeColor } from '@/constants/theme'

const TYPE_STYLE: Record<CommunityMessageType, { icon: Icon; color: ThemeColor; label: string }> = {
  info: { icon: InfoIcon, color: theme.status.info.color, label: 'Announcement' },
  warning: { icon: WarningIcon, color: theme.status.warning.color, label: 'Heads up' },
  critical: { icon: WarningOctagonIcon, color: theme.status.error.color, label: 'Important' },
}

interface CommunityMessageModalProps {
  message: CommunityMessage | null
  onDismiss: () => void
  onAction: (action: CommunityMessageAction) => void
  onExited?: () => void
}

export function CommunityMessageModal({
  message,
  onDismiss,
  onAction,
  onExited,
}: CommunityMessageModalProps) {
  const [rendered, setRendered] = useState<CommunityMessage | null>(message)
  if (message !== null && message !== rendered) setRendered(message)

  if (rendered === null) return null

  const { icon, color, label } = TYPE_STYLE[rendered.type]
  const action = rendered.action

  return (
    <FadeCardModal
      visible={message !== null}
      onDismiss={onDismiss}
      title={rendered.title ?? label}
      titleIcon={icon}
      titleIconColor={color}
      titleColor={color}
      footer={
        action ? (
          <Button
            label={action.label}
            variant={action.type === 'primary' ? 'primary' : 'secondary'}
            onPress={() => onAction(action)}
          />
        ) : (
          <Button label="Dismiss" variant="secondary" onPress={onDismiss} />
        )
      }
      onExited={onExited}
    >
      <Markdown>{rendered.body}</Markdown>
    </FadeCardModal>
  )
}
