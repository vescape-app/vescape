import { DropIcon } from 'phosphor-react-native'
import { StyleSheet, View } from 'react-native'
import type { WeatherIconSlug } from 'vescape-core'
import { Text } from '@/components/base/Text'

import { WeatherIcon } from '@/modules/weather/components/WeatherIcon'
import { theme, type ThemeColor } from '@/constants/theme'
import { temperatureFromC } from '@/helpers/units'
import { useUserPreferences } from '@/hooks/useUserPreferences'

type WeatherStatSize = 'sm' | 'md'

interface WeatherStatProps {
  icon: WeatherIconSlug
  temperatureC: number
  precipProbability?: number | null
  size?: WeatherStatSize
  iconColor?: ThemeColor
}

const SIZES: Record<WeatherStatSize, { icon: number; temp: number; drop: number }> = {
  sm: { icon: 13, temp: 11, drop: 11 },
  md: { icon: 16, temp: 13, drop: 12 },
}

export function WeatherStat({
  icon,
  temperatureC,
  precipProbability,
  size = 'sm',
  iconColor = theme.neutral.textSecondary,
}: WeatherStatProps) {
  const { temperatureUnit } = useUserPreferences()
  const dims = SIZES[size]
  const tempColor = size === 'md' ? theme.neutral.textPrimary : theme.neutral.textSecondary
  const displayTemp = Math.round(temperatureFromC(temperatureC, temperatureUnit))

  return (
    <View style={styles.row}>
      <WeatherIcon icon={icon} size={dims.icon} color={iconColor} weight="duotone" />
      <Text style={[styles.temp, { color: tempColor, fontSize: dims.temp }]}>{displayTemp}°</Text>
      {precipProbability != null && precipProbability > 0 && (
        <>
          <DropIcon size={dims.drop} color={theme.palette.sky.color} weight="duotone" />
          <Text style={styles.precip}>{precipProbability}%</Text>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  temp: {
    fontWeight: '600',
  },
  precip: {
    color: theme.palette.sky.color,
    fontSize: 11,
    fontWeight: '600',
  },
})
