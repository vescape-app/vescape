import { Modal, Pressable, View, StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { XIcon } from 'phosphor-react-native'
import type { Board } from '@/modules/board/store/boardStore'
import { theme } from '@/constants/theme'

interface BoardPickerModalProps {
  visible: boolean
  boards: Board[]
  onSelect: (board: Board) => void
  onDismiss: () => void
}

export function BoardPickerModal({ visible, boards, onSelect, onDismiss }: BoardPickerModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.modalBackdrop} onPress={onDismiss}>
        <Pressable style={styles.promptModal} onPress={(e) => e.stopPropagation()}>
          <View style={styles.promptHeader}>
            <Text style={styles.promptTitle}>Copy to board</Text>
            <Pressable style={styles.promptCloseBtn} onPress={onDismiss}>
              <XIcon size={14} color={theme.palette.slate.text} weight="bold" />
            </Pressable>
          </View>
          {boards.length === 0 ? (
            <Text style={styles.emptyText}>No other boards available.</Text>
          ) : (
            boards.map((board) => (
              <Pressable
                key={board.id}
                style={styles.boardPickerItem}
                onPress={() => onSelect(board)}
              >
                <Text style={styles.boardPickerText}>{board.name}</Text>
              </Pressable>
            ))
          )}
        </Pressable>
      </Pressable>
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
  promptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  promptTitle: {
    color: theme.palette.slate.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  promptCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  boardPickerItem: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: theme.palette.slate.surfaceDeep,
    minHeight: 44,
    justifyContent: 'center',
  },
  boardPickerText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  emptyText: {
    color: theme.palette.slate.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
  },
})
