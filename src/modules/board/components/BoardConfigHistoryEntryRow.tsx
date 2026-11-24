import { Pressable, StyleSheet, View } from 'react-native'
import { ArrowCounterClockwiseIcon, CaretDownIcon, CaretUpIcon } from 'phosphor-react-native'
import type {
  BoardConfigChangeDiff,
  BoardConfigRevision,
  BoardConfigRevisionSource,
} from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { DASH } from '@/helpers/format'
import { formatDateTime, type DateFormat, type TimeFormat } from '@/helpers/time'
import { temperatureFromC, temperatureSymbol, type TemperatureUnit } from '@/helpers/units'
import {
  formatBoardConfigFieldValue,
  formatNumericDisplay,
  isInternalBoardConfigField,
} from '@/modules/board/lib/boardConfigChangeset'
import type { BoardConfigTuningSessionEntry } from '@/modules/board/lib/boardConfigRevisions'
import {
  getFieldLabel,
  type ResolvedBoardConfigField,
} from '@/modules/board/lib/refloatFieldOverlay'

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
  resolvedField?: ResolvedBoardConfigField,
): string {
  if (resolvedField) {
    return formatBoardConfigFieldValue(resolvedField, value, temperatureUnit)
  }
  if (value === null) return DASH
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (unit === '°C') {
    return `${formatNumericDisplay(temperatureFromC(value, temperatureUnit), 1)} ${temperatureSymbol(temperatureUnit)}`
  }
  const formatted = formatNumericDisplay(value, 3)
  return unit ? `${formatted} ${unit}` : formatted
}

function RevisionDiffRow({
  diff,
  temperatureUnit,
  resolvedField,
}: {
  diff: BoardConfigChangeDiff
  temperatureUnit: TemperatureUnit
  resolvedField?: ResolvedBoardConfigField
}) {
  const label = resolvedField?.label ?? getFieldLabel(diff.fieldId, { label: diff.label })
  return (
    <Text style={styles.diffLine} numberOfLines={2}>
      {label}{' '}
      <Text style={styles.diffOld}>
        {formatDiffValue(diff.oldValue, diff.unit, temperatureUnit, resolvedField)}
      </Text>
      {' → '}
      <Text style={styles.diffNew}>
        {formatDiffValue(diff.newValue, diff.unit, temperatureUnit, resolvedField)}
      </Text>
    </Text>
  )
}

function RevertActionButton({
  label,
  disabled,
  loading,
  onPress,
  testID,
}: {
  label: string
  disabled: boolean
  loading: boolean
  onPress: () => void
  testID?: string
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.revertButton,
        (disabled || loading) && styles.revertButtonDisabled,
        pressed && !disabled && !loading && styles.revertButtonPressed,
      ]}
      testID={testID}
    >
      <ArrowCounterClockwiseIcon size={13} color={theme.palette.cyan.text} weight="bold" />
      <Text style={styles.revertButtonText}>{loading ? 'Planning…' : label}</Text>
    </Pressable>
  )
}

export function RevisionRow({
  revision,
  isCurrent,
  isOldest = false,
  canRevert,
  planningRevisionId,
  borderColor,
  timeFormat,
  dateFormat,
  temperatureUnit,
  resolvedFieldsById,
  profileNamesById,
  nested = false,
  onRevert,
}: {
  revision: BoardConfigRevision
  isCurrent: boolean
  isOldest?: boolean
  canRevert: boolean
  planningRevisionId: number | null
  borderColor: string
  timeFormat: TimeFormat
  dateFormat: DateFormat
  temperatureUnit: TemperatureUnit
  resolvedFieldsById?: Readonly<Record<string, ResolvedBoardConfigField>>
  profileNamesById?: Readonly<Record<string, string>>
  nested?: boolean
  onRevert: (revisionId: number) => void
}) {
  const visibleChanges = revision.changes.filter(
    (diff) => !isInternalBoardConfigField(diff.fieldId),
  )
  const isBaseline = isOldest && visibleChanges.length === 0 && revision.source === 'external'
  const badge = isBaseline ? null : sourceBadgeColors(revision.source)
  const profileName = revision.tuneProfileId ? profileNamesById?.[revision.tuneProfileId] : null
  const emptyDetail = isOldest ? 'Initial snapshot' : 'Config changed (no field-level diff)'
  return (
    <View style={[styles.entry, nested && styles.nestedEntry, { borderBottomColor: borderColor }]}>
      <View style={styles.entryHeader}>
        <Text style={styles.entryDate}>
          {formatDateTime(revision.createdAtMs, timeFormat, dateFormat)}
        </Text>
        {badge ? (
          <View
            style={[styles.sourceBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}
          >
            <Text style={[styles.sourceText, { color: badge.text }]}>
              {SOURCE_LABELS[revision.source]}
            </Text>
          </View>
        ) : (
          <View style={[styles.sourceBadge, { borderColor }]}>
            <Text style={styles.baselineText}>Baseline</Text>
          </View>
        )}
        {revision.refloatVersion ? (
          <Text style={styles.version}>v{revision.refloatVersion}</Text>
        ) : null}
        <View style={styles.headerSpacer} />
        {isCurrent ? (
          <Text style={styles.currentLabel}>Current</Text>
        ) : (
          <RevertActionButton
            label="Restore"
            disabled={!canRevert || planningRevisionId !== null}
            loading={planningRevisionId === revision.id}
            onPress={() => onRevert(revision.id)}
            testID={`config-revision-revert-${revision.id}`}
          />
        )}
      </View>
      {revision.tuneProfileId ? (
        <Text style={styles.profileNote}>
          {profileName ? `Synced from profile ${profileName}` : 'Synced from a Tune profile'}
        </Text>
      ) : null}
      {visibleChanges.length > 0 ? (
        <View style={styles.diffs}>
          {visibleChanges.map((diff) => (
            <RevisionDiffRow
              key={diff.fieldId}
              diff={diff}
              temperatureUnit={temperatureUnit}
              resolvedField={resolvedFieldsById?.[diff.fieldId]}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.entryDetail}>{emptyDetail}</Text>
      )}
    </View>
  )
}

export function TuningSessionCard({
  session,
  latestRevisionId,
  oldestRevisionId,
  expanded,
  canRevert,
  planningRevisionId,
  borderColor,
  timeFormat,
  dateFormat,
  temperatureUnit,
  resolvedFieldsById,
  profileNamesById,
  onToggleExpand,
  onRevert,
}: {
  session: BoardConfigTuningSessionEntry
  latestRevisionId: number | null
  oldestRevisionId: number | null
  expanded: boolean
  canRevert: boolean
  planningRevisionId: number | null
  borderColor: string
  timeFormat: TimeFormat
  dateFormat: DateFormat
  temperatureUnit: TemperatureUnit
  resolvedFieldsById?: Readonly<Record<string, ResolvedBoardConfigField>>
  profileNamesById?: Readonly<Record<string, string>>
  onToggleExpand: () => void
  onRevert: (revisionId: number) => void
}) {
  const badge = sourceBadgeColors('app')
  const preSessionId = session.preSessionRevisionId
  const visibleNetChanges = session.netChanges.filter(
    (diff) => !isInternalBoardConfigField(diff.fieldId),
  )
  return (
    <View style={[styles.entry, { borderBottomColor: borderColor }]}>
      <View style={styles.entryHeader}>
        <Pressable
          onPress={onToggleExpand}
          style={styles.sessionToggle}
          testID={`config-session-toggle-${session.id}`}
        >
          {expanded ? (
            <CaretUpIcon size={14} color={theme.neutral.textSecondary} weight="bold" />
          ) : (
            <CaretDownIcon size={14} color={theme.neutral.textSecondary} weight="bold" />
          )}
          <Text style={styles.entryDate}>
            {formatDateTime(session.endedAtMs, timeFormat, dateFormat)}
          </Text>
        </Pressable>
        <View
          style={[styles.sourceBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}
        >
          <Text style={[styles.sourceText, { color: badge.text }]}>
            {`Tuning session · ${session.revisions.length}`}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
        {preSessionId !== null ? (
          <RevertActionButton
            label="Undo session"
            disabled={!canRevert || planningRevisionId !== null}
            loading={planningRevisionId === preSessionId}
            onPress={() => onRevert(preSessionId)}
            testID={`config-session-revert-${session.id}`}
          />
        ) : null}
      </View>

      {visibleNetChanges.length > 0 ? (
        <View style={styles.diffs}>
          {visibleNetChanges.map((diff) => (
            <RevisionDiffRow
              key={diff.fieldId}
              diff={diff}
              temperatureUnit={temperatureUnit}
              resolvedField={resolvedFieldsById?.[diff.fieldId]}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.entryDetail}>No net change across session</Text>
      )}

      {expanded ? (
        <View style={[styles.sessionRevisions, { borderLeftColor: borderColor }]}>
          {session.revisions.map((revision) => (
            <RevisionRow
              key={revision.id}
              revision={revision}
              isCurrent={revision.id === latestRevisionId}
              isOldest={revision.id === oldestRevisionId}
              canRevert={canRevert}
              planningRevisionId={planningRevisionId}
              borderColor={borderColor}
              timeFormat={timeFormat}
              dateFormat={dateFormat}
              temperatureUnit={temperatureUnit}
              resolvedFieldsById={resolvedFieldsById}
              profileNamesById={profileNamesById}
              nested
              onRevert={onRevert}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  entry: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 6,
  },
  nestedEntry: {
    paddingVertical: 8,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerSpacer: {
    flex: 1,
  },
  sessionToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  baselineText: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  profileNote: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  version: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  currentLabel: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  revertButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: theme.palette.cyan.bg,
    borderColor: theme.palette.cyan.border,
  },
  revertButtonDisabled: {
    opacity: 0.45,
  },
  revertButtonPressed: {
    opacity: 0.75,
  },
  revertButtonText: {
    color: theme.palette.cyan.text,
    fontSize: 11,
    fontWeight: '700',
  },
  sessionRevisions: {
    marginTop: 6,
    marginLeft: 6,
    paddingLeft: 10,
    borderLeftWidth: 2,
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
