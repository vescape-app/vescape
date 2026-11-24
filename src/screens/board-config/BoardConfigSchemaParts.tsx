import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { BoardConfigFieldEditor } from '@/modules/board/components/BoardConfigFieldEditor'
import type { BoardConfigSchemaSection } from '@/modules/board/lib/boardConfigSchemaGroups'

export function BoardConfigSchemaSectionCard({
  section,
  pendingChanges,
  refloatBaseVersion,
  disabled = false,
  showDescription,
  onFieldChange,
  onResetField,
}: {
  section: BoardConfigSchemaSection
  pendingChanges: Record<string, number | boolean>
  refloatBaseVersion?: string | null
  disabled?: boolean
  showDescription: boolean
  onFieldChange: (fieldId: string, nextValue: number | boolean) => void
  onResetField: (fieldId: string) => void
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
})
