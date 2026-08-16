import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { CheckCircleIcon, LightningIcon, PencilSimpleIcon, PlusIcon } from 'phosphor-react-native'
import { router } from 'expo-router'
import { routes } from '@/navigation/routes'

import type { Board } from '@/modules/board/store/boardStore'
import { interaction, theme } from '@/constants/theme'
import { FloatingSheet } from '@/components/overlays/AnchoredSheet'
import { TickText } from '@/components/base/TickText'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'

interface BoardSelectorSheetProps {
  visible: boolean
  triggerRef: React.RefObject<View | null>
  boards: Board[]
  activeBoardId: string | null
  /** True while the active board has a live telemetry link, so its row shows the pull rate. */
  activeBoardLive?: boolean
  onClose: () => void
  onSelectBoard: (id: string) => void
  onAddBoard: () => void
}

const PULL_RATE_FONT_SIZE = 11

export function BoardSelectorSheet({
  visible,
  triggerRef,
  boards,
  activeBoardId,
  activeBoardLive = false,
  onClose,
  onSelectBoard,
  onAddBoard,
}: BoardSelectorSheetProps) {
  return (
    <FloatingSheet
      visible={visible}
      triggerRef={triggerRef}
      onClose={onClose}
      matchTriggerWidth={false}
      minWidth={280}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.sectionTitle}>Your Boards</Text>

      {boards.map((board) => {
        const isActive = board.id === activeBoardId
        return (
          <Pressable
            key={board.id}
            style={({ pressed }) => [
              styles.boardRow,
              isActive && styles.boardRowActive,
              pressed && styles.boardRowPressed,
            ]}
            onPress={() => onSelectBoard(board.id)}
          >
            <View style={[styles.boardIcon, isActive && styles.boardIconActive]}>
              <LightningIcon
                size={16}
                color={isActive ? theme.palette.sky.color : theme.neutral.textMuted}
                weight={isActive ? 'fill' : 'regular'}
              />
            </View>
            <View style={styles.boardInfo}>
              <Text style={[styles.boardName, isActive && styles.boardNameActive]}>
                {board.name}
              </Text>
              {isActive && activeBoardLive && (
                <TickText
                  value={liveTelemetryRuntime.values.pullRateHz}
                  decimals={0}
                  unit=" Hz"
                  size={PULL_RATE_FONT_SIZE}
                  color={theme.neutral.textMuted}
                />
              )}
            </View>
            {isActive && (
              <CheckCircleIcon size={20} color={theme.palette.sky.color} weight="fill" />
            )}
            <Pressable
              onPress={(e) => {
                e.stopPropagation()
                onClose()
                router.push({ pathname: routes.editBoard, params: { boardId: board.id } })
              }}
              hitSlop={8}
            >
              <PencilSimpleIcon size={15} color={theme.neutral.textDim} weight="bold" />
            </Pressable>
          </Pressable>
        )
      })}

      <Pressable
        style={({ pressed }) => [styles.addRow, pressed && styles.boardRowPressed]}
        onPress={onAddBoard}
        testID="board-selector-add-board"
        accessibilityLabel="Add new board"
      >
        <View style={styles.addIcon}>
          <PlusIcon size={16} color={theme.palette.sky.color} weight="bold" />
        </View>
        <Text style={styles.addText}>Add new board</Text>
      </Pressable>
    </FloatingSheet>
  )
}

const styles = StyleSheet.create({
  content: {
    padding: 0,
    gap: 0,
  },
  sectionTitle: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    gap: 10,
  },
  boardRowActive: {
    backgroundColor: theme.neutral.surfaceDeep,
  },
  boardRowPressed: {
    backgroundColor: interaction.pressedBg,
  },
  boardIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: theme.neutral.surfaceDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardIconActive: {
    backgroundColor: theme.palette.sky.bg,
  },
  boardInfo: {
    flex: 1,
    gap: 2,
  },
  boardName: {
    color: theme.neutral.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  boardNameActive: {
    color: theme.neutral.textPrimary,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    gap: 10,
  },
  addIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: theme.neutral.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: {
    color: theme.palette.sky.color,
    fontSize: 14,
    fontWeight: '700',
  },
})
