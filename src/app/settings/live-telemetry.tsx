import { StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ClockCountdownIcon, GaugeIcon } from 'phosphor-react-native'
import { useShallow } from 'zustand/react/shallow'

import { theme } from '@/constants/theme'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { Stepper } from '@/components/forms/Stepper'
import { IconHero } from '@/components/settings/IconHero'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

export default function LiveTelemetrySettingsScreen() {
  const { liveHistoryLimit, telemetryPollRateHz, set } = useSettingsStore(
    useShallow((s) => ({
      liveHistoryLimit: s.liveHistoryLimit,
      telemetryPollRateHz: s.telemetryPollRateHz,
      set: s.set,
    })),
  )

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={GaugeIcon}
          description="How much full-rate board data the live charts keep, and how often it is requested."
        />
        <SettingsCard>
          <SettingsRow
            icon={ClockCountdownIcon}
            iconColor={theme.palette.sky.color}
            label="Live telemetry length"
            hint={
              'Minutes of full-rate board data the live charts keep; older data rolls off.\nLonger can slow the app down. Recommended: 5–15 min.'
            }
            right={
              <Stepper
                value={liveHistoryLimit}
                unit="min"
                min={1}
                max={50}
                onChange={(nextValue) => {
                  const clampedValue = Math.min(50, Math.max(1, nextValue))
                  if (clampedValue !== liveHistoryLimit) {
                    void set('liveHistoryLimit', clampedValue)
                  }
                }}
              />
            }
          />
          <SettingsRow
            icon={GaugeIcon}
            iconColor={theme.palette.green.color}
            label="Telemetry rate limit"
            hint="Caps telemetry requests per second. 0 = unlimited"
            right={
              <Stepper
                value={telemetryPollRateHz}
                unit="Hz"
                min={0}
                max={100}
                step={(v, dir) => (dir === 1 ? (v < 5 ? 1 : 5) : v <= 5 ? 1 : 5)}
                onChange={(nextValue) => {
                  const clampedValue = Math.min(100, Math.max(0, nextValue))
                  if (clampedValue !== telemetryPollRateHz) {
                    void set('telemetryPollRateHz', clampedValue)
                  }
                }}
              />
            }
          />
        </SettingsCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
    gap: 8,
  },
})
