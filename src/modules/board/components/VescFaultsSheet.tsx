import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { WarningDiamondIcon } from 'phosphor-react-native'
import { readVescFaultLog, setVescFaultDismissed, type VescFaultOccurrence } from 'vescape-core'

import { Placeholder } from '@/components/base/Placeholder'
import { Text } from '@/components/base/Text'
import { VescFaultRow } from '@/modules/board/components/VescFaultRow'
import { theme } from '@/constants/theme'

interface VescFaultsSheetProps {
  boardId: string
  visible: boolean
  /** VESC Fault Occurrences for this Board, newest first. */
  faults: VescFaultOccurrence[]
}

/**
 * VESC Fault sheet for the selected Board: the controller's own evidence, one row per activation,
 * dismissed per occurrence in native storage. Deliberately separate from the Board Warnings sheet —
 * app-authored warnings and controller faults are different subsystems with different dismissal
 * models, and blurring them hides which one produced a finding.
 *
 * Dismissed occurrences stay listed here even though they do not light the indicator. Raw VESC
 * terminal output is fetched once per drawer opening and never becomes an occurrence.
 */
export function VescFaultsSheet({ boardId, faults, visible }: VescFaultsSheetProps) {
  const [faultLog, setFaultLog] = useState<string | null>(null)
  const [faultLogError, setFaultLogError] = useState<string | null>(null)
  const [readingFaultLog, setReadingFaultLog] = useState(false)

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setReadingFaultLog(true)
    setFaultLog(null)
    setFaultLogError(null)
    void readVescFaultLog(boardId)
      .then((output) => {
        if (!cancelled) setFaultLog(output)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFaultLogError(
            error instanceof Error ? error.message : 'Could not read controller fault log',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setReadingFaultLog(false)
      })
    return () => {
      cancelled = true
    }
  }, [boardId, visible])

  return (
    <View style={styles.list}>
      {faults.length === 0 ? (
        <View style={styles.empty}>
          <Placeholder
            icon={WarningDiamondIcon}
            title="No faults"
            description="No live faults recorded by Vescape."
          />
        </View>
      ) : (
        <View style={styles.faults}>
          {faults.map((fault) => (
            <VescFaultRow
              key={fault.id}
              fault={fault}
              onSetDismissed={(id, value) => void setVescFaultDismissed(id, value)}
            />
          ))}
        </View>
      )}
      <View style={styles.consoleSection}>
        <View style={styles.consoleHeader}>
          <View style={styles.consoleCopy}>
            <Text style={styles.consoleTitle}>Controller fault log</Text>
            <Text style={styles.consoleHint}>
              Read when opened. Board must be connected and stopped.
            </Text>
          </View>
          {readingFaultLog && <ActivityIndicator color={theme.status.caution.color} />}
        </View>
        {faultLogError && <Text style={styles.consoleError}>{faultLogError}</Text>}
        {faultLog != null && (
          <View style={styles.consoleOutput}>
            <Text style={styles.consoleText}>{faultLog.trim() || '(no output)'}</Text>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  list: {
    gap: 16,
  },
  faults: {
    gap: 10,
  },
  empty: {
    paddingVertical: 12,
  },
  consoleSection: {
    gap: 8,
    paddingTop: 4,
  },
  consoleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  consoleCopy: {
    flex: 1,
    gap: 3,
  },
  consoleTitle: {
    color: theme.neutral.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  consoleHint: {
    color: theme.neutral.textMuted,
    fontSize: 11,
  },
  consoleError: {
    color: theme.status.error.text,
    fontSize: 12,
  },
  consoleOutput: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  consoleText: {
    color: theme.neutral.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
  },
})
