import { useState } from 'react'
import { InfoIcon, WarningIcon, WarningOctagonIcon, type Icon } from 'phosphor-react-native'

import type { CommunityMessage, CommunityMessageAction, CommunityMessageType } from 'vescape-core'
import { Button } from '@/components/base/Button'
import { Markdown } from '@/components/base/Markdown'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme, type ThemeColor } from '@/constants/theme'

/**
 * Icon, accent color and fallback header label per message type — the importance cue (PRD story 27).
 * A message carrying its own `title` replaces the label; icon and color always follow the type.
 */
const TYPE_STYLE: Record<CommunityMessageType, { icon: Icon; color: ThemeColor; label: string }> = {
  info: { icon: InfoIcon, color: theme.status.info.color, label: 'Announcement' },
  warning: { icon: WarningIcon, color: theme.status.warning.color, label: 'Heads up' },
  critical: { icon: WarningOctagonIcon, color: theme.status.error.color, label: 'Important' },
}

interface CommunityMessageModalProps {
  /** The message to present, or `null` to dismiss the surface. */
  message: CommunityMessage | null
  onDismiss: () => void
  onAction: (action: CommunityMessageAction) => void
  /** The card finished fading out. Lets the caller hand over to the next Release surface. */
  onExited?: () => void
}

/**
 * One Community Message surface: renders the server Markdown body with a type-colored header and an
 * optional primary/secondary action. Purely presentational — {@link ReleaseSurfaces} owns the queue
 * and decides which message (if any) appears here. A Community Message never changes capability
 * availability; this only communicates.
 */
export function CommunityMessageModal({
  message,
  onDismiss,
  onAction,
  onExited,
}: CommunityMessageModalProps) {
  // Hold the last shown message so the exit animation renders content instead of blanking.
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
