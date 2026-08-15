import { ArrowDownIcon, ArrowUpIcon, DropIcon, SunHorizonIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import type { WeatherIconSlug } from 'vescape-core'
import { Text } from '@/components/base/Text'

import { WeatherIcon } from '@/modules/weather/components/WeatherIcon'
import { WeatherStat } from '@/modules/weather/components/WeatherStat'
import { interaction, theme } from '@/constants/theme'
import { formatHour, weatherIconColor } from '@/modules/weather/lib/weather'

interface WeatherPillProps {
  icon: WeatherIconSlug
  temperature: number
  label: string
  precipProbability?: number | null
  /** Minutes since local midnight; both present or the sun times are hidden. */
  sunriseMinuteOfDay?: number | null
  sunsetMinuteOfDay?: number | null
  expanded?: boolean
  onPress?: () => void
}

/** Map weather summary. Collapsed pill or expanded panel with sun times. */
export function WeatherPill({
  icon,
  temperature,
  label,
  precipProbability,
  sunriseMinuteOfDay,
  sunsetMinuteOfDay,
  expanded,
  onPress,
}: WeatherPillProps) {
  const iconColor = weatherIconColor(icon)

  if (expanded) {
    return (
      <View style={styles.expanded}>
        <WeatherIcon icon={icon} size={28} color={iconColor} weight="duotone" />
        <View style={styles.expandedDetails}>
          <View style={styles.expandedText}>
            <Text style={styles.expandedTemp}>{temperature}°</Text>
            <Text style={styles.expandedLabel}>{label}</Text>
          </View>
          {sunriseMinuteOfDay != null && sunsetMinuteOfDay != null && (
            <View style={styles.sunTimes}>
              <View style={styles.sunTime}>
                <SunHorizonIcon size={14} color={theme.weather.sun} weight="duotone" />
                <ArrowUpIcon size={10} color={theme.weather.sun} weight="bold" />
                <Text style={styles.sunTimeText}>{formatHour(sunriseMinuteOfDay)}</Text>
              </View>
              <View style={styles.sunTime}>
                <SunHorizonIcon size={14} color={theme.weather.moonPartly} weight="duotone" />
                <ArrowDownIcon size={10} color={theme.weather.moonPartly} weight="bold" />
                <Text style={styles.sunTimeText}>{formatHour(sunsetMinuteOfDay)}</Text>
              </View>
            </View>
          )}
        </View>
        {precipProbability != null && precipProbability > 0 && (
          <View style={styles.precipRow}>
            <DropIcon size={14} color={theme.palette.sky.color} weight="duotone" />
            <Text style={styles.precipText}>{precipProbability}%</Text>
          </View>
        )}
      </View>
    )
  }

  return (
    <Pressable style={styles.pill} onPress={onPress} android_ripple={interaction.rippleBorderless}>
      <WeatherStat
        icon={icon}
        temperature={temperature}
        precipProbability={precipProbability}
        size="md"
        iconColor={iconColor}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.6),
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
  },
  expanded: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  expandedText: {
    gap: 1,
  },
  expandedDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  expandedTemp: {
    color: theme.neutral.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  expandedLabel: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  sunTimes: {
    gap: 3,
  },
  sunTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  sunTimeText: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  precipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 8,
  },
  precipText: {
    color: theme.palette.sky.color,
    fontSize: 13,
    fontWeight: '600',
  },
})
