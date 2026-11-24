import { PageScrollView } from '@/components/base/PageScrollView'
import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CalendarBlankIcon, ClockIcon, GaugeIcon, ThermometerIcon } from 'phosphor-react-native'

import { SegmentedToggle } from '@/components/controls/SegmentedToggle'
import { Select, type SelectOption } from '@/components/forms/Select'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { theme } from '@/constants/theme'
import { formatDate, type DateFormat, type TimeFormat } from '@/helpers/time'
import type { TemperatureUnit, DistanceUnit } from '@/helpers/units'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

const EXAMPLE_DATE = new Date(2026, 2, 28)

const DATE_FORMAT_OPTIONS: SelectOption<DateFormat>[] = (
  ['dmy', 'mdy', 'dmy-slash', 'mdy-slash', 'dmy-dot', 'ymd'] as const
).map((value) => ({ value, label: formatDate(EXAMPLE_DATE, value) }))

export default function UnitsSettingsScreen() {
  const distanceUnit = useSettingsStore((state) => state.distanceUnit)
  const temperatureUnit = useSettingsStore((state) => state.temperatureUnit)
  const timeFormat = useSettingsStore((state) => state.timeFormat)
  const dateFormat = useSettingsStore((state) => state.dateFormat)
  const set = useSettingsStore((state) => state.set)

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={GaugeIcon}
          description="Pick how speed, distance, temperature, time and dates read."
        />
        <SettingsCard>
          <SettingsRow
            focusId="speed-distance"
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
            focusId="temperature"
            icon={ThermometerIcon}
            iconColor={theme.palette.red.color}
            label="Temperature"
            hint="Board, watch, weather and alerts"
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
            focusId="time-format"
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
          <SettingsRow
            focusId="date-format"
            icon={CalendarBlankIcon}
            iconColor={theme.palette.purple.color}
            label="Date format"
            right={
              <Select<DateFormat>
                options={DATE_FORMAT_OPTIONS}
                value={dateFormat}
                onChange={(value) => void set('dateFormat', value)}
                style={styles.dateSelect}
                testID="date-format-select"
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
  dateSelect: {
    width: 150,
  },
})
