import { StyleSheet } from 'react-native'
import { InfoIcon, WarningCircleIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme } from '@/constants/theme'

const ACCENTS = {
  info: { Icon: InfoIcon, color: theme.palette.sky.color },
  warning: { Icon: WarningCircleIcon, color: theme.palette.amber.text },
  success: { Icon: InfoIcon, color: theme.palette.green.color },
  danger: { Icon: WarningCircleIcon, color: theme.palette.red.color },
}

interface InfoModalProps {
  visible: boolean
  title: string
  message: string
  variant?: keyof typeof ACCENTS
  dismissLabel?: string
  onDismiss: () => void
}

export function InfoModal({
  visible,
  title,
  message,
  variant = 'info',
  dismissLabel = 'Got it!',
  onDismiss,
}: InfoModalProps) {
  const accent = ACCENTS[variant]

  return (
    <FadeCardModal
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      titleIcon={accent.Icon}
      titleIconColor={accent.color}
      titleIconWeight="fill"
      bodyMaxHeight={280}
      footer={<Button label={dismissLabel} onPress={onDismiss} />}
    >
      <Text style={styles.message} selectable>
        {message}
      </Text>
    </FadeCardModal>
  )
}

const styles = StyleSheet.create({
  message: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
})
