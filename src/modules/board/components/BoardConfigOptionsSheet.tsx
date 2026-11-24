import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  ArrowCounterClockwiseIcon,
  BracketsCurlyIcon,
  ClockCounterClockwiseIcon,
  DownloadSimpleIcon,
  EyeSlashIcon,
  UploadSimpleIcon,
} from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Placeholder } from '@/components/base/Placeholder'
import { Text } from '@/components/base/Text'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { theme } from '@/constants/theme'

interface BoardConfigOptionsSheetViewProps {
  ignoredFields: string[]
  fieldLabels: Record<string, string>
  error?: string | null
  canTransferXml?: boolean
  onOpenHistory?: () => void
  onOpenRawConfig: () => void
  onExportXml?: () => void
  onImportXml?: () => void
  onRestoreField: (fieldId: string) => void
  onRestoreAll: () => void
}

export function BoardConfigOptionsSheetView({
  ignoredFields,
  fieldLabels,
  error,
  canTransferXml = false,
  onOpenHistory,
  onOpenRawConfig,
  onExportXml,
  onImportXml,
  onRestoreField,
  onRestoreAll,
}: BoardConfigOptionsSheetViewProps) {
  return (
    <View style={styles.content}>
      <SettingsCard>
        {onOpenHistory ? (
          <SettingsRow
            icon={ClockCounterClockwiseIcon}
            iconColor={theme.palette.sky.color}
            label="Config history"
            hint="View past config changes, diffs, and revert"
            onPress={onOpenHistory}
          />
        ) : null}
        <SettingsRow
          icon={BracketsCurlyIcon}
          iconColor={theme.palette.sky.color}
          label="Raw board config"
          hint="Inspect decoded Refloat and MCCONF values"
          onPress={onOpenRawConfig}
        />
        {onExportXml ? (
          <SettingsRow
            icon={UploadSimpleIcon}
            iconColor={theme.palette.sky.color}
            label="Export VESC XML"
            hint={
              canTransferXml
                ? 'Share current config in VESC Tool XML format'
                : 'Connect this board to export config'
            }
            onPress={canTransferXml ? onExportXml : undefined}
          />
        ) : null}
        {onImportXml ? (
          <SettingsRow
            icon={DownloadSimpleIcon}
            iconColor={theme.palette.sky.color}
            label="Import VESC XML"
            hint={
              canTransferXml
                ? 'Load settings from a VESC Tool XML file'
                : 'Connect this board to import config'
            }
            onPress={canTransferXml ? onImportXml : undefined}
          />
        ) : null}
      </SettingsCard>

      <SettingsSectionTitle>Ignored change notices</SettingsSectionTitle>

      {ignoredFields.length === 0 ? (
        <View style={styles.empty}>
          <Placeholder
            icon={EyeSlashIcon}
            title="No ignored fields"
            description="Tap the ignore icon on a field in a config change notice to silence future alerts for it."
          />
        </View>
      ) : (
        <>
          <SettingsCard>
            {ignoredFields.map((fieldId) => {
              const label = fieldLabels[fieldId] ?? fieldId
              return (
                <SettingsRow
                  key={fieldId}
                  icon={EyeSlashIcon}
                  label={label}
                  hint={label !== fieldId ? fieldId : undefined}
                  right={
                    <IconButton
                      icon={ArrowCounterClockwiseIcon}
                      size="sm"
                      accessibilityLabel={`Stop ignoring ${label}`}
                      testID={`restore-config-change-${fieldId}`}
                      onPress={() => onRestoreField(fieldId)}
                    />
                  }
                />
              )
            })}
          </SettingsCard>
          {ignoredFields.length > 1 ? (
            <Button
              label="Restore all"
              variant="secondary"
              testID="restore-all-config-changes"
              onPress={onRestoreAll}
            />
          ) : null}
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

interface BoardConfigOptionsSheetProps {
  boardId: string
  fieldLabels: Record<string, string>
  canTransferXml?: boolean
  onOpenHistory?: () => void
  onOpenRawConfig: () => void
  onExportXml?: () => void
  onImportXml?: () => void
}

export function BoardConfigOptionsSheet({
  boardId,
  fieldLabels,
  canTransferXml,
  onOpenHistory,
  onOpenRawConfig,
  onExportXml,
  onImportXml,
}: BoardConfigOptionsSheetProps) {
  const [mutationError, setMutationError] = useState<string | null>(null)
  const ignoredFields = useBoardStore(
    (s) => s.boards.find((b) => b.id === boardId)?.ignoredConfigChangeFields ?? EMPTY_FIELDS,
  )
  const setConfigChangeFieldIgnored = useBoardStore((s) => s.setConfigChangeFieldIgnored)
  const clearIgnoredConfigChangeFields = useBoardStore((s) => s.clearIgnoredConfigChangeFields)

  return (
    <BoardConfigOptionsSheetView
      ignoredFields={ignoredFields}
      fieldLabels={fieldLabels}
      error={mutationError}
      canTransferXml={canTransferXml}
      onOpenHistory={onOpenHistory}
      onOpenRawConfig={onOpenRawConfig}
      onExportXml={onExportXml}
      onImportXml={onImportXml}
      onRestoreField={(fieldId) => {
        setMutationError(null)
        void setConfigChangeFieldIgnored(boardId, fieldId, false).catch(() => {
          setMutationError('Ignored fields could not be updated.')
        })
      }}
      onRestoreAll={() => {
        setMutationError(null)
        void clearIgnoredConfigChangeFields(boardId).catch(() => {
          setMutationError('Ignored fields could not be cleared.')
        })
      }}
    />
  )
}

const EMPTY_FIELDS: string[] = []

const styles = StyleSheet.create({
  content: {
    gap: 10,
  },
  empty: {
    paddingVertical: 8,
  },
  error: {
    color: theme.status.error.text,
    fontSize: 12,
  },
})
