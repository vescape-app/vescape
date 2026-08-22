import { StyleSheet, View } from 'react-native'
import { CloudArrowUpIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme } from '@/constants/theme'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { useSyncStatusStore } from '@/modules/profile/store/syncStatusStore'

interface BackupChoiceModalProps {
  /** Render regardless of the stored choice, with a fixed pending volume — the showcase. */
  preview?: { pendingRows: number }
}

/**
 * The one expensive moment in this feature's life — the first upload on a phone with months of
 * history — offered as a decision rather than something that happened to the Rider.
 *
 * Shown once, with the pending volume, in the flow where backup is turned on. Both answers set the
 * same App Setting the ordinary settings row does; afterwards this never appears again.
 */
export function BackupChoiceModal({ preview }: BackupChoiceModalProps) {
  const status = useSyncStatusStore((state) => state.status)
  const loaded = useSettingsStore((state) => state.loaded)
  const syncEnabled = useSettingsStore((state) => state.syncEnabled)
  const choiceMade = useSettingsStore((state) => state.syncBackupChoiceMade)
  const set = useSettingsStore((state) => state.set)

  // Only once backup is actually on: a phone with the master switch off, or signed out, has nothing
  // to decide about yet.
  const visible =
    preview != null ||
    (loaded && syncEnabled && !choiceMade && status.accountId !== null && status.pause === null)
  const pendingRows = preview?.pendingRows ?? status.pendingRows

  const choose = (wifiOnly: boolean) => {
    void set('syncWifiOnly', wifiOnly)
    void set('syncBackupChoiceMade', true)
  }

  return (
    <FadeCardModal
      visible={visible}
      title="Back up your rides"
      titleIcon={CloudArrowUpIcon}
      titleIconColor={theme.palette.cyan.color}
      scrollable={false}
      footer={
        <View style={styles.actions}>
          <Button
            style={styles.actionBtn}
            label="Wi-Fi only"
            variant="secondary"
            onPress={() => choose(true)}
          />
          <Button style={styles.actionBtn} label="Any connection" onPress={() => choose(false)} />
        </View>
      }
    >
      <Text style={styles.message}>
        {pendingRows > 0
          ? `This phone has ${pendingRows.toLocaleString()} changes waiting to upload. `
          : 'Your rides, boards and tunes will upload as you ride. '}
        Backing up over Wi-Fi only keeps it off your mobile data — including mid-ride. You can
        change this any time in Settings → Database.
      </Text>
    </FadeCardModal>
  )
}

const styles = StyleSheet.create({
  message: {
    color: theme.palette.slate.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
  },
})
