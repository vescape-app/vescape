import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme } from '@/constants/theme'

interface ConfirmModalProps {
  visible: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => Promise<void> | void
  onCancel: () => void
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <FadeCardModal
      visible={visible}
      onDismiss={onCancel}
      dismissDisabled={loading}
      title={title}
      showClose={false}
      scrollable={false}
      cardStyle={styles.card}
      footer={
        <View style={styles.actions}>
          <Button
            style={styles.actionBtn}
            label={cancelLabel}
            variant="secondary"
            disabled={loading}
            onPress={onCancel}
          />
          <Button
            style={styles.actionBtn}
            label={confirmLabel}
            variant={destructive ? 'destructive' : 'primary'}
            loading={loading}
            onPress={onConfirm}
          />
        </View>
      }
    >
      <Text style={styles.message}>{message}</Text>
    </FadeCardModal>
  )
}

const styles = StyleSheet.create({
  card: {
    maxWidth: 320,
    padding: 20,
    gap: 12,
  },
  message: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
  },
})
