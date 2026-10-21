import { Platform, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  AngleIcon,
  ClockCountdownIcon,
  MapTrifoldIcon,
  NavigationArrowIcon,
  PathIcon,
  SignpostIcon,
  StackIcon,
  UsersIcon,
  WatchIcon,
} from 'phosphor-react-native'
import { useShallow } from 'zustand/react/shallow'

import { theme } from '@/constants/theme'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
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

/**
 * Map behind gauges steps, integer percent: Off (0), then 30 to 90 in 15s. Native snaps anything
 * else to the 60 % default.
 * @parity /modules/vescape-core/ios/watch/WatchMapTile.swift `WatchMapGauges`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WatchMapGauges`
 */
const MAP_GAUGES_OFF = 0
const MAP_GAUGES_MIN = 30
const MAP_GAUGES_MAX = 90
const MAP_GAUGES_STEP = 15

function mapGaugesStep(value: number, direction: 1 | -1): number {
  const edge = direction > 0 ? MAP_GAUGES_OFF : MAP_GAUGES_MIN
  return value === edge ? MAP_GAUGES_MIN : MAP_GAUGES_STEP
}

/** Stick speed doubles per step: fine enough at the low end, fast enough at the top. */
const TILT_RATE_MIN = 5
const TILT_RATE_MAX = 40

export default function WatchSettingsScreen() {
  const {
    wearAutoLaunchOnConnect,
    wearPushRateHz,
    wearNavArrowEnabled,
    wearTelemetryTrailEnabled,
    wearTelemetryGroupEnabled,
    wearTelemetryRouteEnabled,
    wearStreetMapEnabled,
    wearMapGaugesPercent,
    wearTiltRatePercent,
    set,
  } = useSettingsStore(
    useShallow((s) => ({
      wearAutoLaunchOnConnect: s.wearAutoLaunchOnConnect,
      wearPushRateHz: s.wearPushRateHz,
      wearNavArrowEnabled: s.wearNavArrowEnabled,
      wearTelemetryTrailEnabled: s.wearTelemetryTrailEnabled,
      wearTelemetryGroupEnabled: s.wearTelemetryGroupEnabled,
      wearTelemetryRouteEnabled: s.wearTelemetryRouteEnabled,
      wearStreetMapEnabled: s.wearStreetMapEnabled,
      wearMapGaugesPercent: s.wearMapGaugesPercent,
      wearTiltRatePercent: s.wearTiltRatePercent,
      set: s.set,
    })),
  )

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero icon={WatchIcon} description="Live telemetry on your watch while you ride." />

        <SettingsSectionTitle>Connection</SettingsSectionTitle>
        <SettingsCard>
          <SettingsRow
            icon={WatchIcon}
            iconColor={theme.settingsIcon.watch}
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
            iconColor={theme.settingsIcon.watch}
            label="Update rate"
            hint="How often the watch gets new readings while its screen is on. Higher is smoother but uses more phone and watch battery"
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
        </SettingsCard>

        <SettingsSectionTitle>Telemetry screen</SettingsSectionTitle>
        <SettingsCard>
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
            icon={UsersIcon}
            iconColor={theme.palette.groupRide.color}
            label="Group Ride on telemetry screen"
            hint="Show your Group Ride behind the watch gauges. Always visible on the map screen"
            right={
              <Switch
                value={wearTelemetryGroupEnabled}
                onValueChange={(v) => void set('wearTelemetryGroupEnabled', v)}
              />
            }
          />
          <SettingsRow
            icon={SignpostIcon}
            iconColor={theme.palette.blue.color}
            label="Route line on telemetry screen"
            hint="Show the navigation route behind the watch gauges. Always visible on the map screen"
            right={
              <Switch
                value={wearTelemetryRouteEnabled}
                onValueChange={(v) => void set('wearTelemetryRouteEnabled', v)}
              />
            }
          />
        </SettingsCard>

        <SettingsSectionTitle>Map</SettingsSectionTitle>
        <SettingsCard>
          <SettingsRow
            icon={MapTrifoldIcon}
            iconColor={theme.settingsIcon.map}
            label="Street map"
            hint="Draw streets under the route on the watch. Off stops sending map tiles to the watch"
            right={
              <Switch
                value={wearStreetMapEnabled}
                onValueChange={(v) => void set('wearStreetMapEnabled', v)}
              />
            }
          />
          {wearStreetMapEnabled ? (
            <SettingsRow
              icon={StackIcon}
              iconColor={theme.settingsIcon.map}
              label="Map behind gauges"
              hint="How strongly streets show behind the watch gauges. Off hides them there. The map screen always shows them fully"
              right={
                <Stepper
                  value={wearMapGaugesPercent}
                  formatValue={(value) => (value === MAP_GAUGES_OFF ? 'Off' : String(value))}
                  unit={wearMapGaugesPercent === MAP_GAUGES_OFF ? undefined : '%'}
                  min={MAP_GAUGES_OFF}
                  max={MAP_GAUGES_MAX}
                  step={mapGaugesStep}
                  onChange={(nextValue) => void set('wearMapGaugesPercent', nextValue)}
                />
              }
            />
          ) : null}
          <SettingsRow
            icon={NavigationArrowIcon}
            iconColor={theme.palette.blue.color}
            label="Navigation arrow"
            hint="Draw the direction chevron over the route. Distance shows either way"
            right={
              <Switch
                value={wearNavArrowEnabled}
                onValueChange={(v) => void set('wearNavArrowEnabled', v)}
              />
            }
          />
        </SettingsCard>

        <SettingsSectionTitle>Controls</SettingsSectionTitle>
        <SettingsCard>
          <SettingsRow
            icon={AngleIcon}
            iconColor={theme.palette.sky.color}
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
