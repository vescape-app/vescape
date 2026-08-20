import { LayoutAnimation, Platform, StyleSheet, Switch, UIManager, View } from 'react-native'
import { CheckIcon, RocketLaunchIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { theme } from '@/constants/theme'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export interface AutoStartBoard {
  id: string
  name: string
  bleId: string
}

export interface AutoStartCardProps {
  /** Master switch — off means nothing wakes the app, whatever boards are armed. */
  enabled: boolean
  /** Every linked board, armed or not. */
  boards: AutoStartBoard[]
  /** Ids of boards that currently trigger auto start. */
  armedBoardIds: string[]
  /** Board mid add/remove — its button spins and locks. */
  busyBoardId?: string | null
  masterBusy?: boolean
  onToggle: (enabled: boolean) => void
  onEnableBoard: (boardId: string) => void
  onDisableBoard: (boardId: string) => void
}

export function AutoStartCard({
  enabled,
  boards,
  armedBoardIds,
  busyBoardId = null,
  masterBusy = false,
  onToggle,
  onEnableBoard,
  onDisableBoard,
}: AutoStartCardProps) {
  const armed = new Set(armedBoardIds)
  const noBoards = boards.length === 0
  const nothingArmed = enabled && armed.size === 0

  const hint = !enabled
    ? 'Open the app by itself when a board powers on'
    : noBoards
      ? 'Link a board first — nothing to detect'
      : nothingArmed
        ? 'No boards enabled — nothing will start the app'
        : `Starts when ${boards
            .filter((board) => armed.has(board.id))
            .map((board) => board.name)
            .join(' or ')} powers on`

  const toggle = (next: boolean) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    onToggle(next)
  }

  const setBoard = (boardId: string, next: boolean) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    if (next) onEnableBoard(boardId)
    else onDisableBoard(boardId)
  }

  return (
    <>
      <SettingsSectionTitle>Wake up</SettingsSectionTitle>
      <SettingsCard separatorInset={0}>
        <SettingsRow
          icon={RocketLaunchIcon}
          iconColor={
            !enabled
              ? theme.palette.slate.textSecondary
              : nothingArmed
                ? theme.palette.amber.color
                : theme.palette.green.color
          }
          label="Auto start app"
          hint={hint}
          right={
            <Switch
              value={enabled}
              // Lockable only into the off state: unlinking every board must never strand the
              // switch on with nothing to turn it off.
              disabled={masterBusy || (noBoards && !enabled)}
              onValueChange={toggle}
              trackColor={{ false: theme.palette.slate.border, true: theme.palette.sky.border }}
              thumbColor={enabled ? theme.palette.sky.color : theme.palette.slate.textMuted}
            />
          }
        />

        {enabled && !noBoards ? (
          <View style={styles.boardList}>
            {boards.map((board) => {
              const isArmed = armed.has(board.id)
              return (
                <View key={board.id} style={styles.boardRow}>
                  <View style={styles.boardText}>
                    <Text style={[styles.boardName, isArmed && styles.boardNameArmed]}>
                      {board.name}
                    </Text>
                    <Text style={styles.boardBleId}>{board.bleId}</Text>
                  </View>
                  <Button
                    label={isArmed ? 'Enabled' : 'Enable'}
                    icon={isArmed ? CheckIcon : undefined}
                    size="sm"
                    variant={isArmed ? 'success' : 'secondary'}
                    loading={busyBoardId === board.id}
                    disabled={busyBoardId != null && busyBoardId !== board.id}
                    onPress={() => setBoard(board.id, !isArmed)}
                  />
                </View>
              )
            })}
          </View>
        ) : null}
      </SettingsCard>
    </>
  )
}

const styles = StyleSheet.create({
  boardList: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 2,
    // Deep surface at partial opacity over the card: recessed, but not a black hole.
    backgroundColor: theme.alpha(theme.palette.slate.surfaceDeep, 0.6),
  },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
  },
  boardText: { flex: 1, gap: 2 },
  boardName: { fontSize: 15, fontWeight: '600' },
  boardNameArmed: { color: theme.palette.green.text },
  boardBleId: { fontSize: 11, color: theme.palette.slate.textMuted },
})
