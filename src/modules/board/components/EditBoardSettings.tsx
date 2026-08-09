import type { ReactNode, RefObject } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  BatteryChargingIcon,
  LightningIcon,
  LinkIcon,
  TrashIcon,
  WarningIcon,
} from 'phosphor-react-native'
import type { BoardLink } from 'vescape-core'

import { BoardSettingRow } from '@/modules/board/components/BoardSettingRow'
import { Button } from '@/components/base/Button'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { interaction, theme } from '@/constants/theme'
import { formatBoardLinkFacts } from '@/modules/board/lib/boardTransport'
import type { BatterySummary } from '@/modules/board/lib/boardSetup'

interface EditBoardSettingsProps {
  name: string
  description: string
  link: BoardLink | null
  linkSaving?: boolean
  keepMissingBatteryConfig: boolean
  batterySummary: BatterySummary
  showBatteryConfig?: boolean
  /** Board-scoped controls composed by the edit route (Board Top Speed + Alert Presets). */
  boardControls?: ReactNode
  /** Active/dismissed Board Warning counts; the row renders only when the board has any warnings. */
  warningCounts: { active: number; dismissed: number }
  /** Anchor for the warnings drawer, wrapped around the warnings row. */
  warningsAnchorRef: RefObject<View | null>
  onOpenWarnings: () => void
  onOpenBattery: () => void
  onLink: () => void
  onRelink: () => void
  onUnlink: () => Promise<void> | void
  onRemove: () => void
}

export function EditBoardSettings({
  name,
  description,
  link,
  linkSaving = false,
  keepMissingBatteryConfig,
  batterySummary,
  showBatteryConfig = true,
  boardControls,
  warningCounts,
  warningsAnchorRef,
  onOpenWarnings,
  onOpenBattery,
  onLink,
  onRelink,
  onUnlink,
  onRemove,
}: EditBoardSettingsProps) {
  return (
    <>
      <IconHero
        icon={LightningIcon}
        title={name.trim() || 'Unnamed board'}
        description={description.trim() || 'No description'}
        iconSize={48}
        iconColor={theme.palette.sky.color}
        iconWeight="duotone"
      />

      {showBatteryConfig ? (
        <SettingsCard>
          <BoardSettingRow
            icon={BatteryChargingIcon}
            iconColor={theme.palette.yellow.text}
            label={keepMissingBatteryConfig ? 'Not configured' : batterySummary.title}
            value={batterySummary.value}
            hint={batterySummary.hint}
            onPress={onOpenBattery}
            testID="edit-board-battery-row"
          />
        </SettingsCard>
      ) : null}

      {boardControls}

      <SettingsCard>
        <SettingsRow
          icon={LinkIcon}
          iconColor={theme.settingsIcon.link}
          label="Board Link"
          hint={link ? formatBoardLinkFacts(link) : 'Not linked — probe a device to ride'}
          right={
            <View style={styles.buttonGroup}>
              {link ? (
                <>
                  <Button
                    style={styles.upgradeButton}
                    label="Re-link"
                    size="sm"
                    loading={linkSaving}
                    onPress={onRelink}
                    testID="edit-board-relink-button"
                  />
                  <Button
                    label="Unlink"
                    variant="destructive"
                    size="sm"
                    loading={linkSaving}
                    onPress={onUnlink}
                    testID="edit-board-unlink-button"
                  />
                </>
              ) : (
                <Button
                  label="Link"
                  variant="secondary"
                  size="sm"
                  loading={linkSaving}
                  onPress={onLink}
                  testID="edit-board-link-button"
                />
              )}
            </View>
          }
        />
      </SettingsCard>

      {warningCounts.active + warningCounts.dismissed > 0 && (
        <View ref={warningsAnchorRef} collapsable={false}>
          <SettingsCard>
            <BoardSettingRow
              icon={WarningIcon}
              iconColor={theme.status.caution.color}
              label="Warnings"
              value={formatWarningCounts(warningCounts)}
              onPress={onOpenWarnings}
              testID="edit-board-warnings-row"
            />
          </SettingsCard>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [styles.removeSection, pressed && styles.removeSectionPressed]}
        android_ripple={interaction.ripple}
        onPress={onRemove}
      >
        <TrashIcon size={14} color={theme.status.error.text} weight="bold" />
        <Text style={styles.removeLabel}>Remove board</Text>
      </Pressable>
    </>
  )
}

function formatWarningCounts({ active, dismissed }: { active: number; dismissed: number }): string {
  const parts: string[] = []
  if (active > 0) parts.push(`${active} active`)
  if (dismissed > 0) parts.push(`${dismissed} dismissed`)
  return parts.join(' · ')
}

const styles = StyleSheet.create({
  buttonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  upgradeButton: {
    backgroundColor: theme.status.upgrade.color,
  },
  removeSection: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  removeSectionPressed: {
    backgroundColor: interaction.pressedBg,
  },
  removeLabel: {
    color: theme.status.error.text,
    fontSize: 12,
    fontWeight: '600',
  },
})
