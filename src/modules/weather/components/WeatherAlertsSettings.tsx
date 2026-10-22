import { useMemo, useRef, useState } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { CloudRainIcon, DotsThreeIcon, GearSixIcon, WindIcon } from 'phosphor-react-native'
import {
  getWeatherAlertThresholds,
  type WeatherAlertThresholds,
  type WeatherAlertLevelSetting,
} from 'vescape-core'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { PillChoiceRow } from '@/components/forms/PillChoiceRow'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { theme } from '@/constants/theme'
import { formatSpeedKmh, type UnitSystem } from '@/helpers/units'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

const LEVEL_OPTIONS: readonly { value: WeatherAlertLevelSetting; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'sensitive', label: 'Sensitive' },
  { value: 'normal', label: 'Normal' },
  { value: 'extreme', label: 'Extreme' },
]

const RAIN_HINTS: Record<WeatherAlertLevelSetting, string> = {
  off: 'No rain alerts.',
  sensitive: 'Warns of light showers too',
  normal: 'Warns of steady rain',
  extreme: 'Warns only of downpours',
}

function rainHint(level: WeatherAlertLevelSetting, thresholds: WeatherAlertThresholds): string {
  if (level === 'off') return RAIN_HINTS.off
  const percent = thresholds[level]?.rainPercent
  return percent == null
    ? `${RAIN_HINTS[level]}.`
    : `${RAIN_HINTS[level]}, from ${percent}% chance.`
}

function windHint(
  level: WeatherAlertLevelSetting,
  thresholds: WeatherAlertThresholds,
  units: UnitSystem,
): string {
  if (level === 'off') return 'No wind alerts.'
  const kmh = thresholds[level]?.gustKmh
  return kmh == null
    ? 'Warns of strong gusts.'
    : `Warns of gusts from ${formatSpeedKmh(kmh, units)}.`
}

export interface WeatherAlertsSettingsViewProps {
  rain: WeatherAlertLevelSetting
  wind: WeatherAlertLevelSetting
  units: UnitSystem
  /** Native-owned gates per level. */
  thresholds: WeatherAlertThresholds
  onRainChange: (level: WeatherAlertLevelSetting) => void
  onWindChange: (level: WeatherAlertLevelSetting) => void
  error?: string | null
}

/** Rider-set Weather Alert levels for rain and wind gusts; storms always speak. */
export function WeatherAlertsSettingsView({
  rain,
  wind,
  units,
  thresholds,
  onRainChange,
  onWindChange,
  error,
}: WeatherAlertsSettingsViewProps) {
  return (
    <View style={styles.content}>
      <SettingsCard>
        <SettingsRow
          icon={CloudRainIcon}
          iconColor={theme.status.warning.color}
          label="Rain alert"
          hint={rainHint(rain, thresholds)}
        >
          <View style={styles.choices}>
            <PillChoiceRow options={LEVEL_OPTIONS} value={rain} onChange={onRainChange} />
          </View>
        </SettingsRow>
        <SettingsRow
          icon={WindIcon}
          iconColor={theme.status.warning.color}
          label="Wind alert"
          hint={windHint(wind, thresholds, units)}
        >
          <View style={styles.choices}>
            <PillChoiceRow options={LEVEL_OPTIONS} value={wind} onChange={onWindChange} />
          </View>
        </SettingsRow>
      </SettingsCard>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

/** Dots button that opens the Weather settings sheet, bound to App Settings. */
export function WeatherAlertsButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const triggerRef = useRef<View>(null)
  const [open, setOpen] = useState(false)
  const rain = useSettingsStore((s) => s.weatherRainAlertLevel)
  const wind = useSettingsStore((s) => s.weatherWindAlertLevel)
  const units = useSettingsStore((s) => s.unitSystem)
  const writeError = useSettingsStore((s) => s.writeError)
  const set = useSettingsStore((s) => s.set)
  const thresholds = useMemo(() => (open ? getWeatherAlertThresholds() : {}), [open])

  return (
    <>
      <View ref={triggerRef} collapsable={false} style={style}>
        <IconButton
          icon={DotsThreeIcon}
          testID="weather-alerts-settings"
          accessibilityLabel="Weather settings"
          onPress={() => setOpen(true)}
        />
      </View>
      <EdgeDrawer
        visible={open}
        triggerRef={triggerRef}
        edge="bottom"
        title="Weather settings"
        icon={GearSixIcon}
        onClose={() => setOpen(false)}
      >
        <WeatherAlertsSettingsView
          rain={rain}
          wind={wind}
          units={units}
          thresholds={thresholds}
          onRainChange={(level) => void set('weatherRainAlertLevel', level)}
          onWindChange={(level) => void set('weatherWindAlertLevel', level)}
          error={writeError}
        />
      </EdgeDrawer>
    </>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 10,
  },
  choices: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  error: {
    color: theme.status.error.text,
    fontSize: 12,
  },
})
