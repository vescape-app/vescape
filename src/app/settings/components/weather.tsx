import { ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'

import { CloudMoonIcon } from 'phosphor-react-native'
import type { WeatherHour, WeatherIconSlug } from 'vescape-core'
import { WeatherIcon } from '@/modules/weather/components/WeatherIcon'
import { WeatherStat } from '@/modules/weather/components/WeatherStat'
import { WeatherPill } from '@/modules/weather/components/WeatherPillView'
import { WeatherHourlyStrip } from '@/modules/weather/components/WeatherHourlyStripView'
import { IconHero } from '@/components/settings/IconHero'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { weatherIconColor } from '@/modules/weather/lib/weather'
import { theme } from '@/constants/theme'

/** Every slug native can resolve, so the showcase covers the whole contract. */
const ICONS: WeatherIconSlug[] = [
  'sun',
  'moon',
  'cloud-sun',
  'cloud-moon',
  'cloud',
  'cloud-fog',
  'cloud-rain',
  'cloud-snow',
  'cloud-lightning',
]

const LABELS: Record<WeatherIconSlug, string> = {
  sun: 'Clear sky',
  moon: 'Clear sky',
  'cloud-sun': 'Partly cloudy',
  'cloud-moon': 'Partly cloudy',
  cloud: 'Overcast',
  'cloud-fog': 'Fog',
  'cloud-rain': 'Rain',
  'cloud-snow': 'Snow',
  'cloud-lightning': 'Thunderstorm',
}

const MOCK_SUNRISE_MINUTE = 5 * 60 + 12
const MOCK_SUNSET_MINUTE = 21 * 60 + 34

const MOCK_HOURLY: WeatherHour[] = [
  {
    minuteOfDay: 14 * 60,
    temperatureC: 21,
    weatherCode: 0,
    icon: 'sun',
    precipitationProbability: 0,
  },
  {
    minuteOfDay: 15 * 60,
    temperatureC: 22,
    weatherCode: 1,
    icon: 'cloud-sun',
    precipitationProbability: 10,
  },
  {
    minuteOfDay: 16 * 60,
    temperatureC: 20,
    weatherCode: 61,
    icon: 'cloud-rain',
    precipitationProbability: 60,
  },
  {
    minuteOfDay: 17 * 60,
    temperatureC: 18,
    weatherCode: 95,
    icon: 'cloud-lightning',
    precipitationProbability: 80,
  },
  {
    minuteOfDay: 18 * 60,
    temperatureC: 17,
    weatherCode: 3,
    icon: 'cloud',
    precipitationProbability: 30,
  },
  {
    minuteOfDay: 22 * 60,
    temperatureC: 13,
    weatherCode: 1,
    icon: 'cloud-moon',
    precipitationProbability: 0,
  },
]

export default function WeatherPage() {
  const [icon, setIcon] = useState<WeatherIconSlug>('sun')
  const [precip, setPrecip] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const precipProbability = precip ? 40 : 0
  const iconColor = weatherIconColor(icon)

  const sharedControls = (
    <>
      <ChipRow
        label="condition"
        options={ICONS}
        selected={icon}
        onSelect={(slug) => setIcon(slug as WeatherIconSlug)}
      />
      <ToggleRow label="precipitation" value={precip} onToggle={setPrecip} />
    </>
  )

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero icon={CloudMoonIcon} description="Weather icons, stat, pill, and hourly strip." />

        <ShowcaseCard name="WeatherIcon" controls={sharedControls}>
          <View style={styles.iconPreview}>
            <WeatherIcon icon={icon} size={48} color={iconColor} weight="duotone" />
            <View>
              <Text style={styles.metaPrimary}>{icon}</Text>
              <Text style={styles.metaSecondary}>{LABELS[icon]}</Text>
            </View>
          </View>
        </ShowcaseCard>

        <ShowcaseCard name="WeatherStat">
          <View style={styles.statPreview}>
            <WeatherStat
              icon={icon}
              temperature={21}
              precipProbability={precipProbability}
              size="sm"
            />
            <WeatherStat
              icon={icon}
              temperature={21}
              precipProbability={precipProbability}
              size="md"
              iconColor={iconColor}
            />
          </View>
        </ShowcaseCard>

        <ShowcaseCard
          name="WeatherPill"
          controls={<ToggleRow label="expanded" value={expanded} onToggle={setExpanded} />}
        >
          <View style={styles.pillPreview}>
            <WeatherPill
              icon={icon}
              temperature={21}
              label={LABELS[icon]}
              precipProbability={precipProbability}
              sunriseMinuteOfDay={MOCK_SUNRISE_MINUTE}
              sunsetMinuteOfDay={MOCK_SUNSET_MINUTE}
              expanded={expanded}
              onPress={() => undefined}
            />
          </View>
        </ShowcaseCard>

        <ShowcaseCard name="WeatherHourlyStrip">
          <View style={styles.stripPreview}>
            <WeatherHourlyStrip hours={MOCK_HOURLY} />
          </View>
        </ShowcaseCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  iconPreview: { flexDirection: 'row', gap: 16, alignItems: 'center', paddingVertical: 8 },
  metaPrimary: { color: theme.neutral.textSecondary, fontSize: 12, fontWeight: '600' },
  metaSecondary: { color: theme.neutral.textDim, fontSize: 11 },
  statPreview: { flexDirection: 'row', gap: 24, alignItems: 'center', paddingVertical: 8 },
  pillPreview: { alignItems: 'flex-start', paddingVertical: 8 },
  stripPreview: { marginHorizontal: -14, paddingVertical: 8 },
})
