import { useState } from 'react'
import { Modal, Pressable, View, StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { CheckIcon } from 'phosphor-react-native'
import { theme } from '@/constants/theme'
import { Input } from '@/components/forms/Input'

interface TextPromptModalContentProps {
  title: string
  placeholder?: string
  initialValue: string
  confirmLabel: string
  /** Allow confirming with an empty value, for fields that can be cleared (e.g. optional names). */
  allowEmpty?: boolean
  onConfirm: (value: string) => void
  onDismiss: () => void
}

function TextPromptModalContent({
  title,
  placeholder,
  initialValue,
  confirmLabel,
  allowEmpty,
  onConfirm,
  onDismiss,
}: TextPromptModalContentProps) {
  const [text, setText] = useState(initialValue)
  return (
    <Pressable style={styles.modalBackdrop} onPress={onDismiss}>
      <Pressable style={styles.promptModal} onPress={(e) => e.stopPropagation()}>
        <Text style={styles.promptTitle}>{title}</Text>
        <Input
          style={styles.promptInput}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={theme.palette.slate.textDim}
          autoFocus
          selectTextOnFocus
        />
        <View style={styles.promptActions}>
          <Pressable style={styles.promptCancelBtn} onPress={onDismiss}>
            <Text style={styles.promptCancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={styles.promptConfirmBtn}
            onPress={() => (allowEmpty || text.trim()) && onConfirm(text.trim())}
          >
            <CheckIcon size={15} color={theme.palette.slate.surfaceDeep} weight="bold" />
            <Text style={styles.promptConfirmText}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </Pressable>
    </Pressable>
  )
}

interface TextPromptModalProps {
  visible: boolean
  title: string
  placeholder?: string
  initialValue: string
  confirmLabel: string
  allowEmpty?: boolean
  onConfirm: (value: string) => void
  onDismiss: () => void
}

export function TextPromptModal({
  visible,
  title,
  placeholder,
  initialValue,
  confirmLabel,
  allowEmpty,
  onConfirm,
  onDismiss,
}: TextPromptModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      {visible ? (
        <TextPromptModalContent
          title={title}
          placeholder={placeholder}
          initialValue={initialValue}
          confirmLabel={confirmLabel}
          allowEmpty={allowEmpty}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />
      ) : null}
    </Modal>
  )
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.6),
    padding: 32,
  },
  promptModal: {
    width: '100%',
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    padding: 16,
    gap: 14,
  },
  promptTitle: {
    color: theme.palette.slate.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  promptInput: {
    fontSize: 16,
    fontWeight: '700',
  },
  promptActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  promptCancelBtn: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptCancelText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  promptConfirmBtn: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.palette.sky.color,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  promptConfirmText: {
    color: theme.palette.slate.surfaceDeep,
    fontSize: 13,
    fontWeight: '900',
  },
})
