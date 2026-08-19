import { StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ClockCountdownIcon, GaugeIcon, WaveformIcon } from 'phosphor-react-native'
import { useShallow } from 'zustand/react/shallow'

import { theme } from '@/constants/theme'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { Stepper } from '@/components/forms/Stepper'
import { IconHero } from '@/components/settings/IconHero'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

export default function LiveTelemetrySettingsScreen() {
  const { liveHistoryLimit, telemetryPollRateHz, socEstimateWindowSeconds, set } = useSettingsStore(
    useShallow((s) => ({
      liveHistoryLimit: s.liveHistoryLimit,
      telemetryPollRateHz: s.telemetryPollRateHz,
      socEstimateWindowSeconds: s.socEstimateWindowSeconds,
      set: s.set,
    })),
  )

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={GaugeIcon}
          description="Control live graph history, telemetry request rate, and battery display smoothing."
        />
        <SettingsCard>
          <SettingsRow
            icon={ClockCountdownIcon}
            iconColor={theme.palette.sky.color}
            label="Live history limit"
            hint="Minutes of telemetry visible in live graphs"
            right={
              <Stepper
                value={liveHistoryLimit}
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
          <SettingsRow
            icon={WaveformIcon}
            iconColor={theme.palette.purple.color}
            label="Battery smoothing"
            hint="Median window steadies battery % for display and alerts. 0 = off"
            right={
              <Stepper
                value={socEstimateWindowSeconds}
                unit="s"
                min={0}
                max={120}
                step={5}
                onChange={(nextValue) => {
                  const clampedValue = Math.min(120, Math.max(0, nextValue))
                  if (clampedValue !== socEstimateWindowSeconds) {
                    void set('socEstimateWindowSeconds', clampedValue)
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
