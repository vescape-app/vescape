import type { RefObject } from 'react'
import { StyleSheet, View } from 'react-native'
import { ClockCounterClockwiseIcon, DotsThreeIcon, InfoIcon } from 'phosphor-react-native'

import { Banner } from '@/components/base/Banner'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { InfoModal } from '@/components/modals/InfoModal'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { BoardConfigFieldEditor } from '@/modules/board/components/BoardConfigFieldEditor'
import { buildBoardConfigFieldInfo } from '@/modules/board/lib/boardConfigChangeset'
import type {
  BoardConfigSchemaRefloatTab,
  BoardConfigSchemaSection,
} from '@/modules/board/lib/boardConfigSchemaGroups'
import type { ResolvedBoardConfigField } from '@/modules/board/lib/refloatFieldOverlay'

export function BoardConfigHeaderActions({
  optionsAnchorRef,
  onOpenHistory,
  onOpenOptions,
}: {
  optionsAnchorRef: RefObject<View | null>
  onOpenHistory: () => void
  onOpenOptions: () => void
}) {
  return (
    <View style={styles.headerActions}>
      <IconButton
        icon={ClockCounterClockwiseIcon}
        onPress={onOpenHistory}
        accessibilityLabel="Config history"
        testID="board-config-history-button"
      />
      <View ref={optionsAnchorRef} collapsable={false}>
        <IconButton
          icon={DotsThreeIcon}
          onPress={onOpenOptions}
          accessibilityLabel="Board config options"
          testID="board-config-options-button"
        />
      </View>
    </View>
  )
}

export function BoardConfigReadInfo({
  refloatReadTime,
  motorReadTime,
  showOfflineHint = false,
}: {
  refloatReadTime: string | null
  motorReadTime: string | null
  showOfflineHint?: boolean
}) {
  const summary =
    refloatReadTime && refloatReadTime === motorReadTime
      ? `Config read ${refloatReadTime}`
      : [
          refloatReadTime ? `Refloat ${refloatReadTime}` : 'No Refloat config',
          motorReadTime ? `Motor ${motorReadTime}` : 'No motor config',
        ].join(' · ')
  return (
    <View style={styles.readInfo}>
      <Text style={styles.readTime}>{summary}</Text>
      {showOfflineHint ? (
        <View style={styles.offlineHintRow}>
          <InfoIcon size={13} color={theme.palette.orange.color} weight="fill" />
          <Text style={styles.offlineHint}>Connect to board to edit config</Text>
        </View>
      ) : null}
    </View>
  )
}

export function BoardConfigStatusBanners({
  xmlError,
  xmlNotice,
}: {
  xmlError: string | null
  xmlNotice: string | null
}) {
  if (!xmlError && !xmlNotice) return null
  return (
    <>
      {xmlError ? <Banner variant="error" message={xmlError} /> : null}
      {xmlNotice ? <Banner variant="info" message={xmlNotice} /> : null}
    </>
  )
}

export function BoardConfigFieldInfoModal({
  field,
  refloatBaseVersion,
  onDismiss,
}: {
  field: ResolvedBoardConfigField | null
  refloatBaseVersion?: string | null
  onDismiss: () => void
}) {
  const info = field ? buildBoardConfigFieldInfo(field, refloatBaseVersion) : null
  return (
    <InfoModal
      visible={info !== null}
      title={info?.title ?? ''}
      message={info?.message ?? ''}
      variant={info?.variant ?? 'info'}
      onDismiss={onDismiss}
    />
  )
}

export function BoardConfigSchemaTabBody({
  tab,
  pendingChanges,
  refloatBaseVersion,
  disabled,
  onFieldChange,
  onResetField,
  onFieldInfoPress,
}: {
  tab: BoardConfigSchemaRefloatTab
  pendingChanges: Record<string, number | boolean>
  refloatBaseVersion?: string | null
  disabled: boolean
  onFieldChange: (fieldId: string, nextValue: number | boolean) => void
  onResetField: (fieldId: string) => void
  onFieldInfoPress?: (field: ResolvedBoardConfigField) => void
}) {
  return (
    <View key={tab.id} style={styles.schemaSections}>
      {tab.readOnly ? (
        <Banner
          variant="info"
          message="Internal metadata fields are read-only and cannot be edited."
        />
      ) : null}
      {tab.sections.map((section) => (
        <BoardConfigSchemaSectionCard
          key={section.id}
          section={section}
          pendingChanges={pendingChanges}
          refloatBaseVersion={refloatBaseVersion}
          disabled={disabled}
          showDescription={tab.id === 'quick'}
          onFieldChange={onFieldChange}
          onResetField={onResetField}
          onFieldInfoPress={onFieldInfoPress}
        />
      ))}
    </View>
  )
}

export function BoardConfigSchemaSectionCard({
  section,
  pendingChanges,
  refloatBaseVersion,
  disabled = false,
  showDescription,
  onFieldChange,
  onResetField,
  onFieldInfoPress,
}: {
  section: BoardConfigSchemaSection
  pendingChanges: Record<string, number | boolean>
  refloatBaseVersion?: string | null
  disabled?: boolean
  showDescription: boolean
  onFieldChange: (fieldId: string, nextValue: number | boolean) => void
  onResetField: (fieldId: string) => void
  onFieldInfoPress?: (field: ResolvedBoardConfigField) => void
}) {
  return (
    <View style={styles.schemaSection}>
      <SettingsSectionTitle>{section.title}</SettingsSectionTitle>
      <SettingsCard separatorInset={14}>
        {section.fields.map((field) => {
          const isModified = field.id in pendingChanges
          const effectiveValue = isModified ? pendingChanges[field.id]! : field.value
          return (
            <BoardConfigFieldEditor
              key={field.id}
              field={field}
              value={effectiveValue}
              isModified={isModified}
              disabled={disabled}
              refloatBaseVersion={refloatBaseVersion}
              showDescription={showDescription}
              onChange={onFieldChange}
              onReset={onResetField}
              onInfoPress={onFieldInfoPress}
            />
          )
        })}
      </SettingsCard>
    </View>
  )
}

export function BoardConfigPendingBar({
  pendingCount,
  riskyPendingCount,
  saving,
  reviewDisabled = false,
  bottomInset,
  onDiscard,
  onReview,
}: {
  pendingCount: number
  riskyPendingCount: number
  saving: boolean
  reviewDisabled?: boolean
  bottomInset: number
  onDiscard: () => void
  onReview: () => void
}) {
  const neutral = useResolvedNeutralColors()
  return (
    <View
      style={[
        styles.pendingBar,
        {
          backgroundColor: neutral.surfaceDeep,
          borderTopColor: neutral.border,
          paddingBottom: Math.max(12, bottomInset + 8),
        },
      ]}
      testID="board-config-pending-bar"
    >
      <View style={styles.pendingMeta}>
        <Text style={styles.pendingCount}>
          {`${pendingCount} pending ${pendingCount === 1 ? 'change' : 'changes'}`}
        </Text>
        {riskyPendingCount > 0 ? (
          <Text style={styles.pendingRisky}>{`${riskyPendingCount} safety-sensitive`}</Text>
        ) : null}
      </View>
      <View style={styles.pendingActions}>
        <Button
          label="Discard"
          variant="secondary"
          disabled={saving}
          onPress={onDiscard}
          testID="board-config-discard"
        />
        <Button
          label="Review"
          variant="primary"
          disabled={saving || reviewDisabled}
          onPress={onReview}
          testID="board-config-review"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  schemaSections: { gap: 18 },
  schemaSection: { gap: 6 },
  pendingBar: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pendingMeta: {
    flex: 1,
    gap: 2,
  },
  pendingCount: {
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  pendingRisky: {
    color: theme.status.warning.text,
    fontSize: 12,
    fontWeight: '600',
  },
  pendingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  readInfo: { alignItems: 'center', gap: 6 },
  readTime: { color: theme.neutral.textMuted, fontSize: 12, textAlign: 'center' },
  offlineHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  offlineHint: { color: theme.palette.orange.text, fontSize: 12, fontWeight: '500' },
})
