import { Modal, Pressable, StyleSheet, View } from 'react-native'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { Input } from '@/components/forms/Input'
import { theme } from '@/constants/theme'

/** Names a zone, whether it is being added or renamed. */
export function ZoneNameModal({
  visible,
  title,
  value,
  confirmLabel,
  testIdPrefix,
  placeholder,
  onChangeText,
  onConfirm,
  onCancel,
}: {
  visible: boolean
  title: string
  value: string
  confirmLabel: string
  testIdPrefix: string
  placeholder: string
  onChangeText: (text: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.modalBackdrop} onPress={onCancel}>
        <Pressable style={styles.modalCard} onPress={() => undefined}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Input
            testID={`${testIdPrefix}-input`}
            style={styles.modalInput}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={theme.neutral.textDim}
            autoFocus
            maxLength={32}
            onSubmitEditing={onConfirm}
            returnKeyType="done"
          />
          <View style={styles.modalActions}>
            <Button
              label="Cancel"
              testID={`${testIdPrefix}-cancel-button`}
              variant="secondary"
              onPress={onCancel}
              style={styles.modalButton}
            />
            <Button
              label={confirmLabel}
              testID={`${testIdPrefix}-${confirmLabel.toLowerCase()}-button`}
              onPress={onConfirm}
              disabled={!value.trim()}
              style={styles.modalButton}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.6),
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: theme.neutral.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    padding: 20,
    gap: 16,
  },
  modalTitle: {
    color: theme.neutral.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  modalInput: {
    borderRadius: 10,
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalButton: {
    flex: 1,
  },
})
