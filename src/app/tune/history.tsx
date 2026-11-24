import { useCallback, useEffect, useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  getBoardConfigRevisions,
  type BoardConfigChangeDiff,
  type BoardConfigRevision,
  type BoardConfigRevisionSource,
} from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { errorMessage } from '@/helpers/error'
import { DASH } from '@/helpers/format'
import { formatDateTime } from '@/helpers/time'
import { temperatureFromC, temperatureSymbol, type TemperatureUnit } from '@/helpers/units'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import { getFieldLabel } from '@/modules/board/lib/refloatFieldOverlay'
import { useBoardConfigValuesStore } from '@/modules/board/store/boardConfigValuesStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { formatTuneValue } from '@/modules/tune/lib/fields'

const SOURCE_LABELS: Record<BoardConfigRevisionSource, string> = {
  app: 'App',
  external: 'External',
  revert: 'Revert',
  import: 'Import',
}

function sourceBadgeColors(source: BoardConfigRevisionSource) {
  switch (source) {
    case 'app':
      return theme.palette.blue
    case 'external':
      return theme.palette.yellow
    case 'revert':
      return theme.palette.cyan
    case 'import':
      return theme.palette.green
  }
}

function formatDiffValue(
  value: number | boolean | null,
  unit: string | null,
  temperatureUnit: TemperatureUnit,
): string {
  if (value === null) return DASH
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (unit === '°C') {
    return `${Math.round(temperatureFromC(value, temperatureUnit))} ${temperatureSymbol(temperatureUnit)}`
  }
  const formatted = formatTuneValue(value)
  return unit ? `${formatted} ${unit}` : formatted
}

function RevisionDiffRow({
  diff,
  temperatureUnit,
}: {
  diff: BoardConfigChangeDiff
  temperatureUnit: TemperatureUnit
}) {
  const label = getFieldLabel(diff.fieldId, { label: diff.label })
  return (
    <Text style={styles.diffLine} numberOfLines={2}>
      {label}{' '}
      <Text style={styles.diffOld}>
        {formatDiffValue(diff.oldValue, diff.unit, temperatureUnit)}
      </Text>
      {' → '}
      <Text style={styles.diffNew}>
        {formatDiffValue(diff.newValue, diff.unit, temperatureUnit)}
      </Text>
    </Text>
  )
}

export default function BoardConfigHistoryScreen() {
  const neutral = useResolvedNeutralColors()
  const { timeFormat, dateFormat, temperatureUnit } = useUserPreferences()
  const selectedBoardId = useBoardStore((s) => s.activeBoardId)
  const lastCapturedAtMs = useBoardConfigValuesStore((s) => s.values?.capturedAtMs ?? null)

  const [revisions, setRevisions] = useState<BoardConfigRevision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (boardId: string) => {
    setLoading(true)
    setError(null)
    try {
      const rows = await getBoardConfigRevisions(boardId)
      setRevisions(rows)
    } catch (err) {
      setError(errorMessage(err, 'Unable to load config history.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedBoardId) {
      setRevisions([])
      return
    }
    void load(selectedBoardId)
  }, [lastCapturedAtMs, load, selectedBoardId])

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!selectedBoardId ? (
        <Text style={styles.empty}>Select a board to view config history.</Text>
      ) : revisions.length === 0 && !loading ? (
        <Text style={styles.empty}>No config revisions recorded yet.</Text>
      ) : (
        <FlatList
          data={revisions}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const badge = sourceBadgeColors(item.source)
            return (
              <View style={[styles.entry, { borderBottomColor: neutral.border }]}>
                <View style={styles.entryHeader}>
                  <Text style={styles.entryDate}>
                    {formatDateTime(item.createdAtMs, timeFormat, dateFormat)}
                  </Text>
                  <View
                    style={[
                      styles.sourceBadge,
                      { backgroundColor: badge.bg, borderColor: badge.border },
                    ]}
                  >
                    <Text style={[styles.sourceText, { color: badge.text }]}>
                      {SOURCE_LABELS[item.source]}
                    </Text>
                  </View>
                  {item.refloatVersion ? (
                    <Text style={styles.version}>v{item.refloatVersion}</Text>
                  ) : null}
                </View>
                {item.changes.length > 0 ? (
                  <View style={styles.diffs}>
                    {item.changes.map((diff) => (
                      <RevisionDiffRow
                        key={diff.fieldId}
                        diff={diff}
                        temperatureUnit={temperatureUnit}
                      />
                    ))}
                  </View>
                ) : (
                  <Text style={styles.entryDetail}>Initial snapshot</Text>
                )}
              </View>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  error: {
    color: theme.status.error.text,
    fontSize: 12,
    padding: 16,
  },
  empty: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  entry: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 6,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  entryDate: {
    color: theme.neutral.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  sourceBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sourceText: {
    fontSize: 11,
    fontWeight: '700',
  },
  version: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  entryDetail: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  diffs: {
    gap: 2,
  },
  diffLine: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  diffOld: {
    color: theme.status.error.text,
    fontWeight: '700',
  },
  diffNew: {
    color: theme.palette.green.text,
    fontWeight: '700',
  },
})
