import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { BoardInfoForm } from '@/modules/board/components/BoardInfoForm'
import {
  BoardPersonalizer,
  type RailColorId,
  type RailId,
} from '@/modules/board/components/add-board-wizard/BoardPersonalizer'
import { Button } from '@/components/base/Button'
import { theme } from '@/constants/theme'

interface BoardInfoEditorModalProps {
  visible: boolean
  name: string
  railId: RailId
  railColorId: RailColorId
  saving?: boolean
  onSave: (value: {
    name: string
    railId: RailId
    railColorId: RailColorId
  }) => Promise<void> | void
  onCancel: () => void
}

export function BoardInfoEditorModal({
  visible,
  name,
  railId,
  railColorId,
  saving = false,
  onSave,
  onCancel,
}: BoardInfoEditorModalProps) {
  const handleCancel = () => {
    if (!saving) onCancel()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <GestureHandlerRootView style={styles.gestureRoot}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.backdrop} onPress={handleCancel} disabled={saving} />
          {visible ? (
            <BoardInfoEditorModalContent
              name={name}
              railId={railId}
              railColorId={railColorId}
              saving={saving}
              onSave={onSave}
            />
          ) : null}
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  )
}

interface BoardInfoEditorModalContentProps {
  name: string
  railId: RailId
  railColorId: RailColorId
  saving: boolean
  onSave: (value: {
    name: string
    railId: RailId
    railColorId: RailColorId
  }) => Promise<void> | void
}

function BoardInfoEditorModalContent({
  name,
  railId,
  railColorId,
  saving,
  onSave,
}: BoardInfoEditorModalContentProps) {
  const [draftName, setDraftName] = useState(name)
  const [draftRailId, setDraftRailId] = useState(railId)
  const [draftRailColorId, setDraftRailColorId] = useState(railColorId)

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Personalize your board</Text>
      <BoardInfoForm
        name={draftName}
        onChangeName={setDraftName}
        nameTestID="edit-board-name-input"
      />
      <BoardPersonalizer
        railId={draftRailId}
        railColorId={draftRailColorId}
        onRailChange={setDraftRailId}
        onRailColorChange={setDraftRailColorId}
      />
      <Button
        label="Save"
        loading={saving}
        onPress={() =>
          onSave({ name: draftName, railId: draftRailId, railColorId: draftRailColorId })
        }
        testID="edit-board-info-save"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
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
    maxWidth: 400,
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    padding: 20,
    gap: 12,
  },
  title: {
    color: theme.palette.slate.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
})
