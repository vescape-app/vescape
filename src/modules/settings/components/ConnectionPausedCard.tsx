import { StyleSheet, View } from 'react-native'
import { PauseCircleIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { theme } from '@/constants/theme'

export interface ConnectionPausedCardProps {
  /** Name of the paused Board, or its id when it has no nickname. */
  boardName: string
  /** Already-formatted remaining time, e.g. `1 h 20 min`. */
  remaining: string
  /** Already-formatted reason, e.g. `you ended the ride`. */
  reason: string
  busy?: boolean
  onConnectNow: () => void
}

/**
 * Automatic Connection Pause, as the rider sees it (ADR 0035): the Board is still nearby and still
 * reported by the Presence Scan, but nothing will connect it on its own until the deadline — unless
 * the rider taps **Connect now**, which is an explicit Connect and clears the pause.
 */
export function ConnectionPausedCard({
  boardName,
  remaining,
  reason,
  busy = false,
  onConnectNow,
}: ConnectionPausedCardProps) {
  return (
    <>
      <SettingsSectionTitle>Auto connect paused</SettingsSectionTitle>
      <SettingsCard>
        <SettingsRow
          icon={PauseCircleIcon}
          iconColor={theme.palette.orange.color}
          label={`Paused for ${remaining}`}
          hint={`${boardName} won’t connect on its own because ${reason}.`}
        />
        <View style={styles.action}>
          <Button label="Connect now" size="sm" loading={busy} onPress={onConnectNow} />
        </View>
      </SettingsCard>
    </>
  )
}

const styles = StyleSheet.create({
  action: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    alignItems: 'flex-start',
  },
})
