import { useMemo, useRef, useState } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { CloudLightningIcon, CloudRainIcon, GearSixIcon, WindIcon } from 'phosphor-react-native'
import {
  getWeatherAlertGustThresholdsKmh,
  type WeatherAlertLevel,
  type WeatherAlertLevelSetting,
} from 'vescape-core'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { Switch } from '@/components/controls/Switch'
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
  { value: 'severe', label: 'Severe only' },
]

const RAIN_HINTS: Record<WeatherAlertLevelSetting, string> = {
  off: 'No rain alerts.',
  sensitive: 'Warns of light showers too.',
  normal: 'Warns of steady rain.',
  severe: 'Warns only of downpours.',
}

function windHint(
  level: WeatherAlertLevelSetting,
  gustsKmh: Partial<Record<WeatherAlertLevel, number>>,
  units: UnitSystem,
): string {
  if (level === 'off') return 'No wind alerts.'
  const kmh = gustsKmh[level]
  return kmh == null
    ? 'Warns of strong gusts.'
    : `Warns of gusts from ${formatSpeedKmh(kmh, units)}.`
}

export interface WeatherAlertsSettingsViewProps {
  rain: WeatherAlertLevelSetting
  wind: WeatherAlertLevelSetting
  storm: boolean
  units: UnitSystem
  /** Native-owned gust gate per level, km/h. */
  gustsKmh: Partial<Record<WeatherAlertLevel, number>>
  onRainChange: (level: WeatherAlertLevelSetting) => void
  onWindChange: (level: WeatherAlertLevelSetting) => void
  onStormChange: (enabled: boolean) => void
  error?: string | null
}

/** Rider-set Weather Alert levels: rain, wind gusts and storms. */
export function WeatherAlertsSettingsView({
  rain,
  wind,
  storm,
  units,
  gustsKmh,
  onRainChange,
  onWindChange,
  onStormChange,
  error,
}: WeatherAlertsSettingsViewProps) {
  return (
    <View style={styles.content}>
      <SettingsCard>
        <SettingsRow icon={CloudRainIcon} label="Rain" hint={RAIN_HINTS[rain]}>
          <View style={styles.choices}>
            <PillChoiceRow options={LEVEL_OPTIONS} value={rain} onChange={onRainChange} />
          </View>
        </SettingsRow>
        <SettingsRow icon={WindIcon} label="Wind" hint={windHint(wind, gustsKmh, units)}>
          <View style={styles.choices}>
            <PillChoiceRow options={LEVEL_OPTIONS} value={wind} onChange={onWindChange} />
          </View>
        </SettingsRow>
        <SettingsRow
          icon={CloudLightningIcon}
          label="Storm"
          hint="Warns of thunderstorms."
          right={<Switch value={storm} onValueChange={onStormChange} />}
        />
      </SettingsCard>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

/** Gear button that opens the Weather Alerts sheet, bound to App Settings. */
export function WeatherAlertsButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const triggerRef = useRef<View>(null)
  const [open, setOpen] = useState(false)
  const rain = useSettingsStore((s) => s.weatherRainAlertLevel)
  const wind = useSettingsStore((s) => s.weatherWindAlertLevel)
  const storm = useSettingsStore((s) => s.weatherStormAlertEnabled)
  const units = useSettingsStore((s) => s.unitSystem)
  const writeError = useSettingsStore((s) => s.writeError)
  const set = useSettingsStore((s) => s.set)
  const gustsKmh = useMemo(() => (open ? getWeatherAlertGustThresholdsKmh() : {}), [open])

  return (
    <>
      <View ref={triggerRef} collapsable={false} style={style}>
        <IconButton
          icon={GearSixIcon}
          testID="weather-alerts-settings"
          accessibilityLabel="Weather alert settings"
          onPress={() => setOpen(true)}
        />
      </View>
      <EdgeDrawer
        visible={open}
        triggerRef={triggerRef}
        edge="bottom"
        title="Weather Alerts"
        icon={CloudLightningIcon}
        onClose={() => setOpen(false)}
      >
        <WeatherAlertsSettingsView
          rain={rain}
          wind={wind}
          storm={storm}
          units={units}
          gustsKmh={gustsKmh}
          onRainChange={(level) => void set('weatherRainAlertLevel', level)}
          onWindChange={(level) => void set('weatherWindAlertLevel', level)}
          onStormChange={(enabled) => void set('weatherStormAlertEnabled', enabled)}
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
