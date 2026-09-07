import { Pressable, StyleSheet, View } from 'react-native'
import {
  EngineIcon,
  LightningIcon,
  PencilSimpleIcon,
  PlusIcon,
  WarningDiamondIcon,
  type Icon,
} from 'phosphor-react-native'
import type { BoardWarningSeverity } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { FloatingSheet } from '@/components/overlays/AnchoredSheet'
import { TickText } from '@/components/base/TickText'
import type { Board } from '@/modules/board/store/boardStore'
import { severityStatus } from '@/modules/board/constants/boardWarnings'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { fmtTimeAgo } from '@/helpers/format'
import { interaction, theme } from '@/constants/theme'

/** A way into the active board's trouble, offered only while that surface is enabled. */
export interface BoardSelectorLink {
  count: number
  onPress: () => void
}

interface BoardSelectorContentProps {
  boards: Board[]
  activeBoardId: string | null
  /** True while the active board has a live telemetry link, so its row shows the pull rate. */
  activeBoardLive?: boolean
  warnings?: (BoardSelectorLink & { severity: BoardWarningSeverity | null }) | undefined
  faults?: BoardSelectorLink | undefined
  onSelectBoard: (id: string) => void
  onAddBoard: () => void
  onEditBoard: (id: string) => void
}

interface BoardSelectorSheetProps extends BoardSelectorContentProps {
  visible: boolean
  triggerRef: React.RefObject<View | null>
  onClose: () => void
}

const PULL_RATE_FONT_SIZE = 11

/**
 * What is known about a board while it is not talking: last battery, how long ago that was, and
 * whether it is even linked. Gray throughout — none of it is live.
 */
function StaleMeta({ board }: { board: Board }) {
  if (!board.link) return <Text style={styles.metaText}>Not linked</Text>
  const last = board.lastBattery
  return (
    <View style={styles.metaLine}>
      {last && <Text style={styles.metaBattery}>{`${Math.round(last.percent)}%`}</Text>}
      {last && <Text style={styles.metaText}>{fmtTimeAgo(last.at)}</Text>}
      {last && <Text style={styles.metaText}>·</Text>}
      <Text style={styles.metaText}>Offline</Text>
    </View>
  )
}

/** The active board's link state. A pull rate exists only while the board is actually connected. */
function ActiveMeta({ board, live }: { board: Board; live: boolean }) {
  return (
    <View style={styles.metaLine}>
      <View
        style={[
          styles.dot,
          {
            borderColor: live ? theme.status.success.color : theme.neutral.textDim,
            backgroundColor: live ? theme.status.success.color : 'transparent',
          },
        ]}
      />
      {live ? (
        <TickText
          value={liveTelemetryRuntime.values.pullRateHz}
          decimals={0}
          unit=" Hz"
          size={PULL_RATE_FONT_SIZE}
          color={theme.status.success.color}
        />
      ) : (
        <StaleMeta board={board} />
      )}
    </View>
  )
}

interface StripLink {
  key: string
  icon: Icon
  label: string
  color: string
  count: number
  onPress: () => void
}

/**
 * Warnings, VESC faults and Edit — the ways into the active board that used to hide behind the
 * pencil. A link with nothing behind it grays out, so color always means "there is something here".
 */
function LinksStrip({ links }: { links: StripLink[] }) {
  return (
    <View style={styles.strip}>
      {links.map(({ key, icon: Icon, label, color: activeColor, count, onPress }, index) => {
        const color = count > 0 ? activeColor : theme.neutral.textDim
        return (
          <View key={key} style={styles.stripCell}>
            {index > 0 && <View style={styles.stripDivider} />}
            <Pressable
              onPress={onPress}
              style={({ pressed }) => [styles.segment, pressed && styles.rowPressed]}
              accessibilityLabel={label}
            >
              <View style={styles.segmentGlyph}>
                <Icon size={17} color={color} weight="duotone" />
                {count > 0 && (
                  <View style={[styles.countRing, { borderColor: color }]}>
                    <Text style={[styles.count, { color }]}>{count}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.segmentLabel}>{label}</Text>
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}

function BoardIcon({ active }: { active: boolean }) {
  return (
    <View style={[styles.boardIcon, active && styles.boardIconActive]}>
      <LightningIcon
        size={16}
        color={active ? theme.palette.sky.color : theme.neutral.textMuted}
        weight={active ? 'fill' : 'regular'}
      />
    </View>
  )
}

/**
 * The selector's list, without the floating shell around it — one picker where the active board
 * leads, one line taller, with its links attached underneath.
 */
export function BoardSelectorContent({
  boards,
  activeBoardId,
  activeBoardLive = false,
  warnings,
  faults,
  onSelectBoard,
  onAddBoard,
  onEditBoard,
}: BoardSelectorContentProps) {
  const active = boards.find((b) => b.id === activeBoardId)
  const others = boards.filter((b) => b.id !== active?.id)
  const links: StripLink[] = [
    ...(warnings
      ? [
          {
            key: 'warnings',
            icon: EngineIcon,
            label: 'Warnings',
            color: severityStatus(warnings.severity ?? 'warn').color,
            count: warnings.count,
            onPress: warnings.onPress,
          },
        ]
      : []),
    ...(faults
      ? [
          {
            key: 'faults',
            icon: WarningDiamondIcon,
            label: 'VESC faults',
            color: theme.status.error.color,
            count: faults.count,
            onPress: faults.onPress,
          },
        ]
      : []),
    ...(active
      ? [
          {
            key: 'edit',
            icon: PencilSimpleIcon,
            label: 'Edit',
            color: theme.neutral.textDim,
            count: 0,
            onPress: () => onEditBoard(active.id),
          },
        ]
      : []),
  ]

  return (
    <>
      {active && (
        <View style={styles.activeBlock}>
          <View style={styles.row}>
            <BoardIcon active />
            <View style={styles.rowInfo}>
              <Text style={styles.boardNameActive} numberOfLines={1}>
                {active.name}
              </Text>
              <ActiveMeta board={active} live={activeBoardLive} />
            </View>
          </View>
          {links.length > 0 && <LinksStrip links={links} />}
        </View>
      )}

      {others.map((board) => (
        <Pressable
          key={board.id}
          style={({ pressed }) => [styles.row, styles.listRow, pressed && styles.rowPressed]}
          onPress={() => onSelectBoard(board.id)}
        >
          <BoardIcon active={false} />
          <View style={styles.rowInfo}>
            <Text style={styles.boardName} numberOfLines={1}>
              {board.name}
            </Text>
            <StaleMeta board={board} />
          </View>
        </Pressable>
      ))}

      {/* Adding a board is an action under the picker, not another board in it — with nothing to
          divide it from, it drops the rule and stands alone. */}
      <View style={[styles.footer, boards.length === 0 && styles.footerBare]}>
        <Pressable
          style={({ pressed }) => [styles.footerButton, pressed && styles.rowPressed]}
          onPress={onAddBoard}
          testID="board-selector-add-board"
          accessibilityLabel="Add new board"
        >
          <PlusIcon size={13} color={theme.palette.sky.color} weight="bold" />
          <Text style={styles.footerText}>Add new board</Text>
        </Pressable>
      </View>
    </>
  )
}

export function BoardSelectorSheet({
  visible,
  triggerRef,
  onClose,
  ...content
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
      <BoardSelectorContent {...content} />
    </FloatingSheet>
  )
}

const styles = StyleSheet.create({
  content: {
    padding: 0,
    paddingVertical: 8,
    gap: 0,
  },
  activeBlock: {
    marginHorizontal: 8,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: theme.neutral.surfaceDeep,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 10,
  },
  listRow: {
    marginHorizontal: 8,
    borderRadius: 10,
  },
  rowPressed: {
    backgroundColor: interaction.pressedBg,
  },
  rowInfo: {
    flex: 1,
    gap: 3,
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
  boardName: {
    color: theme.neutral.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  boardNameActive: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },

  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: 1.5,
  },
  // Mono and Raleway sit on different baselines; a shared line height keeps the row on one line.
  metaBattery: {
    fontFamily: theme.mono('600'),
    color: theme.neutral.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  metaText: {
    color: theme.neutral.textDim,
    fontSize: 11,
    lineHeight: 14,
  },

  strip: {
    flexDirection: 'row',
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: theme.alpha(theme.neutral.border, 0.6),
  },
  stripCell: {
    flex: 1,
    flexDirection: 'row',
  },
  stripDivider: {
    width: StyleSheet.hairlineWidth * 2,
    backgroundColor: theme.alpha(theme.neutral.border, 0.6),
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    paddingVertical: 10,
  },
  segmentGlyph: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countRing: {
    position: 'absolute',
    left: 11,
    top: -4,
    minWidth: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  count: {
    fontFamily: theme.mono('700'),
    fontSize: 8,
    lineHeight: 9,
  },
  segmentLabel: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },

  footer: {
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: theme.alpha(theme.neutral.border, 0.6),
  },
  footerBare: {
    marginTop: 0,
    paddingTop: 0,
    borderTopWidth: 0,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 8,
    paddingVertical: 11,
    borderRadius: 10,
  },
  footerText: {
    color: theme.palette.sky.color,
    fontSize: 13,
    fontWeight: '700',
  },
})
