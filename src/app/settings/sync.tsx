import { ScrollView, StyleSheet, Switch, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CloudArrowUpIcon, WifiHighIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import { BackupStatusLine } from '@/modules/profile/components/BackupStatusLine'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

export default function SyncSettingsScreen() {
  const syncEnabled = useSettingsStore((s) => s.syncEnabled)
  const syncWifiOnly = useSettingsStore((s) => s.syncWifiOnly)
  const set = useSettingsStore((s) => s.set)

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={CloudArrowUpIcon}
          description="Keep everything this phone records on your Vescape account."
        />

        <SettingsCard>
          <SettingsRow
            icon={CloudArrowUpIcon}
            iconColor={theme.palette.cyan.color}
            label="Back up to Vescape"
            hint="Rides, boards, tunes and settings. Off means nothing is uploaded at all"
            right={
              <Switch
                value={syncEnabled}
                onValueChange={(v) => void set('syncEnabled', v)}
                trackColor={{ false: theme.palette.slate.border, true: theme.palette.sky.border }}
                thumbColor={syncEnabled ? theme.palette.sky.color : theme.palette.slate.textMuted}
              />
            }
          >
            <View style={styles.status}>
              <BackupStatusLine />
            </View>
          </SettingsRow>

          {syncEnabled ? (
            <SettingsRow
              icon={WifiHighIcon}
              iconColor={theme.palette.cyan.color}
              label="Back up over Wi-Fi only"
              hint="Nothing uploads on mobile data, including during a ride"
              right={
                <Switch
                  value={syncWifiOnly}
                  onValueChange={(v) => void set('syncWifiOnly', v)}
                  trackColor={{ false: theme.palette.slate.border, true: theme.palette.sky.border }}
                  thumbColor={
                    syncWifiOnly ? theme.palette.sky.color : theme.palette.slate.textMuted
                  }
                />
              }
            />
          ) : null}
        </SettingsCard>

        <View style={styles.note}>
          <Text style={styles.noteText}>
            Backup is off by default and stays on this phone until you turn it on. Switching it off
            stops the uploader immediately; nothing already uploaded is deleted, and this switch is
            never restored from a backup.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  status: { paddingHorizontal: 14, paddingBottom: 14 },
  note: { paddingHorizontal: 4 },
  noteText: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
})
