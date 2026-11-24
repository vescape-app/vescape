import { StyleSheet, View } from 'react-native'
import {
  ArrowCounterClockwiseIcon,
  DownloadSimpleIcon,
  InfoIcon,
  SlidersHorizontalIcon,
  WarningIcon,
} from 'phosphor-react-native'

import { Banner } from '@/components/base/Banner'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import type {
  BoardConfigReviewEntry,
  BoardConfigReviewSource,
  BoardConfigSkippedField,
} from '@/modules/board/lib/boardConfigChangeset'

export interface BoardConfigReviewModalProps {
  visible: boolean
  source: BoardConfigReviewSource
  boardName?: string | null
  entries: BoardConfigReviewEntry[]
  skippedFields?: BoardConfigSkippedField[]
  saving?: boolean
  confirmDisabled?: boolean
  error?: string | null
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

const SOURCE_META: Record<
  BoardConfigReviewSource,
  { title: string; confirmLabel: string; retryLabel: string; icon: typeof SlidersHorizontalIcon }
> = {
  app: {
    title: 'Review config changes',
    confirmLabel: 'Apply changes',
    retryLabel: 'Retry apply',
    icon: SlidersHorizontalIcon,
  },
  revert: {
    title: 'Review config revert',
    confirmLabel: 'Revert config',
    retryLabel: 'Retry revert',
    icon: ArrowCounterClockwiseIcon,
  },
  import: {
    title: 'Review config import',
    confirmLabel: 'Import config',
    retryLabel: 'Retry import',
    icon: DownloadSimpleIcon,
  },
}

export function BoardConfigReviewModal({
  visible,
  source,
  boardName,
  entries,
  skippedFields = EMPTY_SKIPPED,
  saving = false,
  confirmDisabled = false,
  error,
  onConfirm,
  onCancel,
}: BoardConfigReviewModalProps) {
  const neutral = useResolvedNeutralColors()
  const meta = SOURCE_META[source]
  const riskyCount = entries.filter((entry) => entry.risk === 'risky').length
  const rebootEntries = entries.filter((entry) => entry.rebootNote != null)

  return (
    <FadeCardModal
      visible={visible}
      title={meta.title}
      titleIcon={meta.icon}
      titleIconColor={theme.palette.sky.color}
      onDismiss={onCancel}
      dismissDisabled={saving}
      bodyMaxHeight={420}
      cardStyle={styles.card}
      footer={
        <View style={styles.footer}>
          <Button
            label="Cancel"
            variant="secondary"
            disabled={saving}
            onPress={onCancel}
            style={styles.footerButton}
            testID="board-config-review-cancel"
          />
          <Button
            label={saving ? 'Writing…' : error ? meta.retryLabel : meta.confirmLabel}
            variant={riskyCount > 0 ? 'destructive' : 'primary'}
            disabled={saving || confirmDisabled || entries.length === 0}
            onPress={() => void onConfirm()}
            style={styles.footerButton}
            testID="board-config-review-confirm"
          />
        </View>
      }
    >
      <View style={styles.body}>
        <Text style={styles.subtitle}>
          {boardName
            ? `${entries.length} ${entries.length === 1 ? 'change' : 'changes'} for ${boardName}`
            : `${entries.length} ${entries.length === 1 ? 'change' : 'changes'} to write`}
        </Text>

        {riskyCount > 0 ? (
          <Banner
            variant="warning"
            title="Safety-sensitive settings included"
            message={`${riskyCount} ${riskyCount === 1 ? 'field affects' : 'fields affect'} cutoffs, specs, or board safety. Double-check values before writing.`}
          />
        ) : null}

        {rebootEntries.length > 0 ? (
          <Banner
            variant="info"
            title="Board reboot required"
            message={
              rebootEntries.length === 1
                ? rebootEntries[0]!.rebootNote!
                : 'Some LED settings require a board reboot before they take effect.'
            }
          />
        ) : null}

        {error ? <Banner variant="error" title="Write failed" message={error} /> : null}

        <View style={styles.list}>
          {entries.map((entry) => {
            const isRisky = entry.risk === 'risky'
            return (
              <View
                key={entry.fieldId}
                style={[styles.entryRow, { borderBottomColor: neutral.border }]}
                testID={`board-config-review-row-${entry.fieldId}`}
              >
                <View style={styles.entryHeader}>
                  <Text style={styles.entryLabel}>{entry.label}</Text>
                  {isRisky ? (
                    <View style={styles.riskBadge}>
                      <WarningIcon size={12} color={theme.status.warning.text} weight="duotone" />
                      <Text style={styles.riskBadgeText}>Risky</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.diffLine}>
                  <Text style={styles.diffOld}>{entry.oldFormatted}</Text>
                  {' → '}
                  <Text style={styles.diffNew}>{entry.newFormatted}</Text>
                </Text>
                {entry.rebootNote ? (
                  <View style={styles.rebootLine}>
                    <InfoIcon size={12} color={theme.palette.sky.color} weight="duotone" />
                    <Text style={styles.rebootText}>{entry.rebootNote}</Text>
                  </View>
                ) : null}
              </View>
            )
          })}
        </View>

        {skippedFields.length > 0 ? (
          <View style={styles.skippedSection}>
            <Text style={styles.skippedTitle}>{`Skipped (${skippedFields.length})`}</Text>
            {skippedFields.map((skipped) => (
              <View
                key={skipped.fieldId}
                style={[styles.skippedRow, { borderBottomColor: neutral.border }]}
              >
                <Text style={styles.skippedLabel}>{skipped.label ?? skipped.fieldId}</Text>
                <Text style={styles.skippedReason}>{skipped.reason}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </FadeCardModal>
  )
}

const EMPTY_SKIPPED: BoardConfigSkippedField[] = []

const styles = StyleSheet.create({
  card: {
    maxWidth: 420,
  },
  body: {
    gap: 12,
  },
  subtitle: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  list: {
    gap: 2,
  },
  entryRow: {
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  entryLabel: {
    flex: 1,
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  riskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: theme.status.warning.bg,
    borderColor: theme.status.warning.border,
  },
  riskBadgeText: {
    color: theme.status.warning.text,
    fontSize: 11,
    fontWeight: '700',
  },
  diffLine: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  diffOld: {
    color: theme.status.error.text,
    fontWeight: '700',
  },
  diffNew: {
    color: theme.palette.green.text,
    fontWeight: '700',
  },
  rebootLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  rebootText: {
    flex: 1,
    color: theme.palette.sky.text,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
  },
  skippedSection: {
    marginTop: 4,
    gap: 4,
  },
  skippedTitle: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  skippedRow: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  skippedLabel: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  skippedReason: {
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
  },
  footerButton: {
    flex: 1,
  },
})
