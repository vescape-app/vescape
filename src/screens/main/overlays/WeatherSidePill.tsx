import { DropIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import type { WeatherIconSlug } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { WeatherIcon } from '@/modules/weather/components/WeatherIcon'

/** Compact weather control aligned opposite the map selectors on the home overlay. */
export function WeatherSidePill({
  icon,
  temperature,
  precipProbability,
  verticalOffset,
  onPress,
}: {
  icon: WeatherIconSlug
  temperature: number
  precipProbability: number | null
  verticalOffset: number
  onPress?: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={`Weather, ${temperature} degrees`}
      onPress={onPress}
      style={[styles.pill, { transform: [{ translateY: verticalOffset }] }]}
    >
      <WeatherIcon
        icon={icon}
        size={18}
        color={theme.palette.slate.textSecondary}
        weight="duotone"
      />
      <Text style={styles.temperature}>{temperature}°</Text>
      {precipProbability != null && precipProbability > 0 ? (
        <View style={styles.precipitation}>
          <DropIcon size={9} color={theme.palette.sky.color} weight="duotone" />
          <Text style={styles.precipitationText}>{precipProbability}%</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    top: '50%',
    right: 12,
    width: 38,
    height: 64,
    marginTop: -32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  temperature: {
    color: theme.palette.slate.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  precipitation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  precipitationText: {
    color: theme.palette.sky.color,
    fontSize: 8,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
})
