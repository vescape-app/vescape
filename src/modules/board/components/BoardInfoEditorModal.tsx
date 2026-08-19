import { useState } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'

import { BoardInfoForm } from '@/modules/board/components/BoardInfoForm'
import { Button } from '@/components/base/Button'
import { theme } from '@/constants/theme'

interface BoardInfoEditorModalProps {
  visible: boolean
  name: string
  description: string
  saving?: boolean
  onSave: (value: { name: string; description: string }) => Promise<void> | void
  onCancel: () => void
}

export function BoardInfoEditorModal({
  visible,
  name,
  description,
  saving = false,
  onSave,
  onCancel,
}: BoardInfoEditorModalProps) {
  const handleCancel = () => {
    if (!saving) onCancel()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleCancel} disabled={saving} />
        {visible ? (
          <BoardInfoEditorModalContent
            name={name}
            description={description}
            saving={saving}
            onSave={onSave}
          />
        ) : null}
      </View>
    </Modal>
  )
}

interface BoardInfoEditorModalContentProps {
  name: string
  description: string
  saving: boolean
  onSave: (value: { name: string; description: string }) => Promise<void> | void
}

function BoardInfoEditorModalContent({
  name,
  description,
  saving,
  onSave,
}: BoardInfoEditorModalContentProps) {
  const [draftName, setDraftName] = useState(name)
  const [draftDescription, setDraftDescription] = useState(description)

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Board info</Text>
      <BoardInfoForm
        name={draftName}
        description={draftDescription}
        onChangeName={setDraftName}
        onChangeDescription={setDraftDescription}
        nameTestID="edit-board-name-input"
        descriptionTestID="edit-board-description-input"
      />
      <Button
        label="Save"
        loading={saving}
        onPress={() => onSave({ name: draftName, description: draftDescription })}
        testID="edit-board-info-save"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.6),
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: theme.neutral.surfaceDeep,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    padding: 20,
    gap: 12,
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
})
