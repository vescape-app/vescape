import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { CheckCircleIcon, LightningIcon, PencilSimpleIcon, PlusIcon } from 'phosphor-react-native'
import { router } from 'expo-router'
import { routes } from '@/navigation/routes'

import type { Board } from '@/modules/board/store/boardStore'
import { interaction, theme } from '@/constants/theme'
import { EdgeDrawer } from '@/components/overlays/AnchoredSheet'
import { TickText } from '@/components/base/TickText'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { BoardStyleIcon } from '@/modules/board/components/add-board-wizard/BoardPersonalizer'

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
    <EdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      edge="top"
      title="Your Boards"
      icon={LightningIcon}
      iconColor={theme.palette.sky.color}
      onClose={onClose}
    >
      <View style={styles.content}>
        {boards.map((board) => {
          const isActive = board.id === activeBoardId
          return (
            <Pressable
              key={board.id}
              style={({ pressed }) => [
                styles.boardCard,
                isActive && styles.boardCardActive,
                pressed && styles.boardCardPressed,
              ]}
              onPress={() => onSelectBoard(board.id)}
            >
              <View style={[styles.boardIcon, isActive && styles.boardIconActive]}>
                <BoardStyleIcon
                  railId={board.personalization?.railId}
                  railColorId={board.personalization?.railColorId}
                />
              </View>
              <View style={styles.boardInfo}>
                <Text style={[styles.boardName, isActive && styles.boardNameActive]}>
                  {board.name}
                </Text>
                {isActive && activeBoardLive ? (
                  <TickText
                    value={liveTelemetryRuntime.values.pullRateHz}
                    decimals={0}
                    unit=" Hz"
                    size={PULL_RATE_FONT_SIZE}
                    color={theme.palette.slate.textMuted}
                  />
                ) : (
                  <Text style={styles.boardStyleName}>
                    {board.personalization?.railId?.toUpperCase() ?? 'XR'}
                  </Text>
                )}
              </View>
              {isActive ? (
                <CheckCircleIcon size={20} color={theme.palette.sky.color} weight="fill" />
              ) : null}
              <Pressable
                onPress={(event) => {
                  event.stopPropagation()
                  onClose()
                  router.push({ pathname: routes.editBoard, params: { boardId: board.id } })
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${board.name}`}
                style={({ pressed }) => [styles.editButton, pressed && styles.editButtonPressed]}
              >
                <PencilSimpleIcon size={16} color={theme.palette.slate.textDim} weight="bold" />
              </Pressable>
            </Pressable>
          )
        })}

        <Pressable
          style={({ pressed }) => [styles.addCard, pressed && styles.boardCardPressed]}
          onPress={onAddBoard}
          testID="board-selector-add-board"
          accessibilityLabel="Add new board"
        >
          <View style={styles.addIcon}>
            <PlusIcon size={18} color={theme.palette.sky.color} weight="bold" />
          </View>
          <Text style={styles.addText}>Add new board</Text>
        </Pressable>
      </View>
    </EdgeDrawer>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    gap: 10,
  },
  boardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
    gap: 12,
  },
  boardCardActive: {
    borderColor: theme.palette.sky.border,
    backgroundColor: theme.palette.sky.bg,
  },
  boardCardPressed: {
    backgroundColor: interaction.pressedBg,
  },
  boardIcon: {
    width: 68,
    height: 44,
    borderRadius: 10,
    backgroundColor: theme.palette.slate.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardIconActive: {
    backgroundColor: theme.palette.sky.bg,
  },
  boardInfo: {
    flex: 1,
    gap: 3,
  },
  boardName: {
    color: theme.palette.slate.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  boardNameActive: {
    color: theme.palette.slate.textPrimary,
  },
  boardStyleName: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButtonPressed: {
    backgroundColor: interaction.pressedBg,
  },
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.palette.slate.border,
    gap: 12,
  },
  addIcon: {
    width: 68,
    height: 40,
    borderRadius: 10,
    backgroundColor: theme.palette.sky.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: {
    color: theme.palette.sky.color,
    fontSize: 14,
    fontWeight: '700',
  },
})
