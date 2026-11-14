import { PageScrollView } from '@/components/base/PageScrollView'
import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ClockIcon, GaugeIcon, ThermometerIcon } from 'phosphor-react-native'

import { SegmentedToggle } from '@/components/controls/SegmentedToggle'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { theme } from '@/constants/theme'
import type { TimeFormat } from '@/helpers/time'
import type { TemperatureUnit, DistanceUnit } from '@/helpers/units'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

export default function UnitsSettingsScreen() {
  const distanceUnit = useSettingsStore((state) => state.distanceUnit)
  const temperatureUnit = useSettingsStore((state) => state.temperatureUnit)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const set = useSettingsStore((state) => state.set)

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={GaugeIcon}
          description="Pick how speed, distance, temperature and time read."
        />
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
          <SettingsRow
            icon={ClockIcon}
            iconColor={theme.palette.sky.color}
            label="Time format"
            hint={timeFormat === '24h' ? '14:30' : '2:30 PM'}
            right={
              <SegmentedToggle<TimeFormat>
                options={[
                  { label: '24h', value: '24h' },
                  { label: '12h', value: '12h' },
                ]}
                value={timeFormat}
                onChange={(value) => void set('timeFormat', value)}
                testID="time-format-toggle"
              />
            }
          />
        </SettingsCard>
      </PageScrollView>
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
