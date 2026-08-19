import { FloatingStatusPill } from '@/components/controls/FloatingBar'
import { theme } from '@/constants/theme'
import { useAlternativeHint } from '@/modules/board/hooks/useAlternativeHint'

/**
 * One advisory switch-and-connect offer at a time (ADR 0035, #408).
 *
 * The Presence Scan saw another linked Board advertising nearby. It was never connected and never
 * will be by this pill on its own — **Switch** is an explicit rider Connect, **Later** is a local
 * acknowledgement that reveals the next queued Board and pauses nothing.
 */
export function AlternativeHintPill() {
  const { hint, dismiss, switchAndConnect } = useAlternativeHint()
  if (!hint) return null

  return (
    <FloatingStatusPill
      pill={{
        kind: 'offer',
        text: `${hint.name ?? 'Another board'} is nearby`,
        acceptText: 'Switch',
        dismissText: 'Later',
        bg: theme.status.info.bg,
        border: theme.status.info.border,
        textColor: theme.status.info.text,
        acceptBg: theme.status.info.color,
        onAccept: switchAndConnect,
        onDismiss: dismiss,
        testID: 'alternative-hint',
        acceptTestID: 'alternative-hint-switch',
        dismissTestID: 'alternative-hint-dismiss',
      }}
    />
  )
}
