import { Platform, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  AngleIcon,
  ClockCountdownIcon,
  NavigationArrowIcon,
  PathIcon,
  WatchIcon,
} from 'phosphor-react-native'
import { useShallow } from 'zustand/react/shallow'

import { theme } from '@/constants/theme'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { Switch } from '@/components/controls/Switch'
import { Stepper } from '@/components/forms/Stepper'
import { IconHero } from '@/components/settings/IconHero'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/**
 * watchOS has no public API for an iPhone app to launch its watch companion — the one that exists
 * (`HKHealthStore.startWatchApp`) starts a HealthKit workout session, which is fitness tracking
 * Vescape does not do. So the switch is shown and disabled rather than hidden: a rider who set it
 * on Android and switched phones should be told why it stopped working, not left guessing.
 *
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `defaultSettings`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMirrorLauncher.kt
 */
const AUTO_LAUNCH_SUPPORTED = Platform.OS === 'android'

/** Stick speed doubles per step: fine enough at the low end, fast enough at the top. */
const TILT_RATE_MIN = 5
const TILT_RATE_MAX = 40

export default function WatchSettingsScreen() {
  const {
    wearAutoLaunchOnConnect,
    wearPushRateHz,
    wearNavArrowEnabled,
    wearTelemetryTrailEnabled,
    wearTiltRatePercent,
    set,
  } = useSettingsStore(
    useShallow((s) => ({
      wearAutoLaunchOnConnect: s.wearAutoLaunchOnConnect,
      wearPushRateHz: s.wearPushRateHz,
      wearNavArrowEnabled: s.wearNavArrowEnabled,
      wearTelemetryTrailEnabled: s.wearTelemetryTrailEnabled,
      wearTiltRatePercent: s.wearTiltRatePercent,
      set: s.set,
    })),
  )

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero icon={WatchIcon} description="Live telemetry on your watch while you ride." />
        <SettingsCard>
          <SettingsRow
            icon={WatchIcon}
            iconColor={theme.palette.amber.color}
            label="Open on connect"
            hint={
              AUTO_LAUNCH_SUPPORTED
                ? 'Bring the watch app to the front when the board connects'
                : 'Apple Watch only. Open the Vescape app on the watch yourself'
            }
            right={
              <Switch
                value={AUTO_LAUNCH_SUPPORTED && wearAutoLaunchOnConnect}
                disabled={!AUTO_LAUNCH_SUPPORTED}
                onValueChange={(v) => void set('wearAutoLaunchOnConnect', v)}
              />
            }
          />
          <SettingsRow
            icon={ClockCountdownIcon}
            iconColor={theme.palette.cyan.color}
            label="Push rate"
            hint="Frames per second sent to the wrist. Higher = faster updates (stress test)"
            right={
              <Stepper
                value={wearPushRateHz}
                unit="Hz"
                min={1}
                max={20}
                step={() => 1}
                onChange={(nextValue) => {
                  const clampedValue = Math.min(20, Math.max(1, nextValue))
                  if (clampedValue !== wearPushRateHz) {
                    void set('wearPushRateHz', clampedValue)
                  }
                }}
              />
            }
          />
          <SettingsRow
            icon={NavigationArrowIcon}
            iconColor={theme.palette.violet.color}
            label="Navigation arrow"
            hint="Draw the direction chevron over the route. Route and distance show either way"
            right={
              <Switch
                value={wearNavArrowEnabled}
                onValueChange={(v) => void set('wearNavArrowEnabled', v)}
              />
            }
          />
          <SettingsRow
            icon={PathIcon}
            iconColor={theme.palette.violet.color}
            label="Trail on telemetry screen"
            hint="Show where you have ridden behind the watch gauges. Always visible on the map screen"
            right={
              <Switch
                value={wearTelemetryTrailEnabled}
                onValueChange={(v) => void set('wearTelemetryTrailEnabled', v)}
              />
            }
          />
          <SettingsRow
            icon={AngleIcon}
            iconColor={theme.palette.green.color}
            label="Tilt speed"
            hint="How fast the watch Tilt stick changes tilt when pushed all the way"
            right={
              <Stepper
                value={wearTiltRatePercent}
                unit="%/s"
                min={TILT_RATE_MIN}
                max={TILT_RATE_MAX}
                step={(value, direction) => (direction > 0 ? value : value / 2)}
                onChange={(nextValue) => {
                  const clampedValue = Math.min(TILT_RATE_MAX, Math.max(TILT_RATE_MIN, nextValue))
                  if (clampedValue !== wearTiltRatePercent) {
                    void set('wearTiltRatePercent', clampedValue)
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
