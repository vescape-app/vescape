import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { GaugeIcon, ThermometerIcon } from 'phosphor-react-native'

import { SegmentedToggle } from '@/components/controls/SegmentedToggle'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { theme } from '@/constants/theme'
import type { TemperatureUnit, DistanceUnit } from '@/helpers/units'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

export default function UnitsSettingsScreen() {
  const distanceUnit = useSettingsStore((state) => state.distanceUnit)
  const temperatureUnit = useSettingsStore((state) => state.temperatureUnit)
  const set = useSettingsStore((state) => state.set)

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero icon={GaugeIcon} description="Pick how speed, distance and temperature read." />
        <SettingsCard>
          <SettingsRow
            icon={GaugeIcon}
            iconColor={theme.palette.amber.color}
            label="Speed & distance"
            hint={distanceUnit === 'km' ? 'km/h · km · m' : 'mph · mi · ft'}
            right={
              <SegmentedToggle<DistanceUnit>
                options={[
                  { label: 'km/h', value: 'km' },
                  { label: 'mph', value: 'mi' },
                ]}
                value={distanceUnit}
                onChange={(value) => void set('distanceUnit', value)}
                testID="unit-system-toggle"
              />
            }
          />
          <SettingsRow
            icon={ThermometerIcon}
            iconColor={theme.palette.red.color}
            label="Temperature"
            hint="Weather and spoken alerts"
            right={
              <SegmentedToggle<TemperatureUnit>
                options={[
                  { label: '°C', value: 'celsius' },
                  { label: '°F', value: 'fahrenheit' },
                ]}
                value={temperatureUnit}
                onChange={(value) => void set('temperatureUnit', value)}
                testID="temperature-unit-toggle"
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
