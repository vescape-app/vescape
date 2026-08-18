import { Pressable, StyleSheet, View } from 'react-native'
import {
  clearAllBoardWarnings,
  devInjectBoardWarning,
  devReportCleanBoardWarning,
} from 'vescape-core'
import { useCallback } from 'react'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { EMPTY_WARNINGS, useBoardWarningsStore } from '@/modules/board/store/boardWarningsStore'

/** Fake kind used by the dev warning injector; real detector kinds land in later slices. */
const DEV_WARNING_KIND = 'cell-spread'
/** Board id used when no board is selected, so the pipe is demoable without a saved board. */
const DEV_WARNING_BOARD_ID = 'dev-board'

/** Fires warnings through the native registry and mirrors what the store received back. */
export function BoardWarningProbe() {
  const warningBoardId = useBoardStore((s) => s.activeBoardId) ?? DEV_WARNING_BOARD_ID
  const boardWarnings = useBoardWarningsStore(
    (s) => s.warningsByBoard[warningBoardId] ?? EMPTY_WARNINGS,
  )

  const injectWarning = useCallback(
    (severity: 'warn' | 'critical') => {
      const payload = JSON.stringify({
        peakSpread: severity === 'critical' ? 0.27 : 0.12,
        worstGroup: 4,
        injectedAt: Date.now(),
      })
      void devInjectBoardWarning(warningBoardId, DEV_WARNING_KIND, severity, payload)
    },
    [warningBoardId],
  )

  const reportClean = useCallback(() => {
    void devReportCleanBoardWarning(warningBoardId, DEV_WARNING_KIND)
  }, [warningBoardId])

  const clearWarnings = useCallback(() => {
    void clearAllBoardWarnings(warningBoardId)
  }, [warningBoardId])

  return (
    <>
      <Text style={styles.sectionTitle}>Board Warnings</Text>
      <View style={styles.card}>
        <Text style={styles.ttsHint}>
          Injects a fake warning through the native registry (fire → persist → emit). Target board:{' '}
          {warningBoardId}
        </Text>
        <View style={styles.warningButtonRow}>
          <Pressable
            style={[styles.warningButton, styles.warningButtonWarn]}
            onPress={() => injectWarning('warn')}
          >
            <Text style={styles.warningButtonText}>Inject warn</Text>
          </Pressable>
          <Pressable
            style={[styles.warningButton, styles.warningButtonCritical]}
            onPress={() => injectWarning('critical')}
          >
            <Text style={styles.warningButtonText}>Inject critical</Text>
          </Pressable>
        </View>
        <View style={styles.warningButtonRow}>
          <Pressable style={styles.warningButton} onPress={reportClean}>
            <Text style={styles.warningButtonText}>Report clean</Text>
          </Pressable>
          <Pressable style={styles.warningButton} onPress={clearWarnings}>
            <Text style={styles.warningButtonText}>Clear all</Text>
          </Pressable>
        </View>
        {boardWarnings.length === 0 ? (
          <Text style={styles.warningEmpty}>No warnings (mirror store empty)</Text>
        ) : (
          boardWarnings.map((warning) => (
            <View key={warning.kind} style={styles.warningRow}>
              <Text style={styles.warningRowKind}>
                {warning.kind} · {warning.severity}
              </Text>
              <Text style={styles.warningRowPayload} numberOfLines={1}>
                {warning.payloadJson}
              </Text>
            </View>
          ))
        )}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  sectionTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 4,
  },
  card: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    overflow: 'hidden',
    padding: 14,
  },
  ttsHint: {
    color: theme.palette.slate.textDim,
    fontSize: 11,
    marginBottom: 10,
    lineHeight: 16,
  },
  warningButtonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  warningButton: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    borderRadius: 8,
    paddingVertical: 12,
  },
  warningButtonWarn: {
    borderColor: theme.status.warning.color,
  },
  warningButtonCritical: {
    borderColor: theme.status.error.color,
  },
  warningButtonText: {
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  warningEmpty: {
    color: theme.palette.slate.textDim,
    fontSize: 12,
    marginTop: 12,
  },
  warningRow: {
    marginTop: 12,
    gap: 2,
  },
  warningRowKind: {
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  warningRowPayload: {
    color: theme.palette.slate.textDim,
    fontSize: 11,
    fontFamily: 'monospace',
  },
})
