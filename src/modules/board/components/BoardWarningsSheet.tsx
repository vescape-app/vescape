import { StyleSheet, View } from 'react-native'
import { ShieldCheckIcon } from 'phosphor-react-native'
import { setVescFaultDismissed, type BoardWarning, type VescFaultOccurrence } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { Text } from '@/components/base/Text'
import { BoardWarningRow } from '@/modules/board/components/BoardWarningRow'
import { VescFaultRow } from '@/modules/board/components/VescFaultRow'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { theme } from '@/constants/theme'

interface BoardWarningsSheetProps {
  boardId: string
  warnings: BoardWarning[]
  /** VESC Fault Occurrences for this Board, newest first. Rendered as their own group. */
  faults: VescFaultOccurrence[]
}

/**
 * Board health sheet for the selected Board: two independent groups.
 *
 * **Board Warnings** are app-authored findings, keyed one row per kind, dismissed per kind on the
 * board record. **VESC Faults** are the controller's own evidence — one row per activation,
 * dismissed per occurrence in native storage. Keeping them visually separate tells the rider which
 * subsystem produced each finding, and stops the two very different dismissal models from blurring.
 */
export function BoardWarningsSheet({ boardId, warnings, faults }: BoardWarningsSheetProps) {
  const dismissedKinds = useBoardStore(
    (s) => s.boards.find((b) => b.id === boardId)?.dismissedWarnings ?? EMPTY_KINDS,
  )
  const setWarningDismissed = useBoardStore((s) => s.setWarningDismissed)
  const dismissAllWarnings = useBoardStore((s) => s.dismissAllWarnings)

  if (warnings.length === 0 && faults.length === 0) {
    return (
      <View style={styles.empty}>
        <Placeholder
          icon={ShieldCheckIcon}
          title="No warnings"
          description="This board is clean."
        />
      </View>
    )
  }

  const active = warnings.filter((w) => !dismissedKinds.includes(w.kind))
  const dismissed = warnings.filter((w) => dismissedKinds.includes(w.kind))

  return (
    <View style={styles.list}>
      {warnings.length > 0 && (
        <View style={styles.group}>
          {faults.length > 0 && <Text style={styles.groupTitle}>Board warnings</Text>}
          {[...active, ...dismissed].map((warning) => (
            <BoardWarningRow
              key={warning.kind}
              warning={warning}
              dismissed={dismissedKinds.includes(warning.kind)}
              onSetDismissed={(kind, value) => void setWarningDismissed(boardId, kind, value)}
            />
          ))}
          {active.length > 1 && (
            <Button
              label="Dismiss all"
              variant="secondary"
              onPress={() =>
                void dismissAllWarnings(
                  boardId,
                  active.map((w) => w.kind),
                )
              }
            />
          )}
        </View>
      )}

      {faults.length > 0 && (
        <View style={styles.group}>
          <Text style={styles.groupTitle}>VESC faults</Text>
          {faults.map((fault) => (
            <VescFaultRow
              key={fault.id}
              fault={fault}
              onSetDismissed={(id, value) => void setVescFaultDismissed(id, value)}
            />
          ))}
        </View>
      )}
    </View>
  )
}

/** Stable empty array so the selector doesn't churn references for boards with nothing dismissed. */
const EMPTY_KINDS: string[] = []

const styles = StyleSheet.create({
  list: {
    gap: 16,
  },
  group: {
    gap: 10,
  },
  groupTitle: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  empty: {
    paddingVertical: 12,
  },
})
