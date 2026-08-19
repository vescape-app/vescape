import { DropIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import { Canvas, Circle, Path, Skia, useClock } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'
import type { WeatherIconSlug } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedColor } from '@/hooks/useTheme'
import { WeatherIcon } from '@/modules/weather/components/WeatherIcon'

const PILL_WIDTH = 38
const PILL_HEIGHT = 64
const WAVE_LENGTH = 32
const WAVE_AMPLITUDE = 2
const FULL_WATER_SURFACE_Y = 4
const EMPTY_WATER_SURFACE_Y = PILL_HEIGHT - 4

const SNOWFLAKES = [
  { x: 7, phase: 0.05, speed: 7, drift: 1.5, radius: 0.8 },
  { x: 17, phase: 0.42, speed: 9, drift: 2.5, radius: 1.1 },
  { x: 29, phase: 0.18, speed: 6, drift: 2, radius: 0.9 },
  { x: 11, phase: 0.72, speed: 8, drift: 2, radius: 1 },
  { x: 33, phase: 0.58, speed: 10, drift: 1.5, radius: 0.7 },
  { x: 23, phase: 0.88, speed: 7, drift: 2.5, radius: 1.1 },
] as const

function Snowflake({
  clock,
  flake,
}: {
  clock: SharedValue<number>
  flake: (typeof SNOWFLAKES)[number]
}) {
  const snowColor = useResolvedColor(theme.weather.snow)
  const y = useDerivedValue(
    () =>
      ((((clock.value / 1000) * flake.speed) % PILL_HEIGHT) + flake.phase * PILL_HEIGHT) %
      PILL_HEIGHT,
  )
  const x = useDerivedValue(
    () => flake.x + Math.sin((clock.value / 1000) * 0.8 + flake.phase * Math.PI * 2) * flake.drift,
  )
  const opacity = useDerivedValue(() => Math.min(y.value / 5, (PILL_HEIGHT - y.value) / 5, 0.75))

  return <Circle cx={x} cy={y} r={flake.radius} color={snowColor} opacity={opacity} />
}

function Snowfall() {
  const clock = useClock()
  return (
    <Canvas pointerEvents="none" style={styles.weatherCanvas}>
      {SNOWFLAKES.map((flake, index) => (
        <Snowflake key={index} clock={clock} flake={flake} />
      ))}
    </Canvas>
  )
}

function RainWaterFill({ probability }: { probability: number }) {
  const waterFillColor = useResolvedColor(theme.alpha(theme.palette.sky.color, 0.12))
  const waterStrokeColor = useResolvedColor(theme.alpha(theme.palette.sky.light, 0.6))
  const clock = useClock()
  const fill = Math.min(1, Math.max(0, probability / 100))
  const surfaceY =
    FULL_WATER_SURFACE_Y + (EMPTY_WATER_SURFACE_Y - FULL_WATER_SURFACE_Y) * (1 - fill)
  const wavePath = useDerivedValue(() => {
    const path = Skia.Path.Make()
    const phase = (clock.value / 1000) * Math.PI * 1.4

    path.moveTo(0, surfaceY + Math.sin(phase) * WAVE_AMPLITUDE)
    for (let x = 1; x <= PILL_WIDTH; x += 1) {
      const y = surfaceY + Math.sin((x / WAVE_LENGTH) * Math.PI * 2 + phase) * WAVE_AMPLITUDE
      path.lineTo(x, y)
    }
    return path
  })
  const waterPath = useDerivedValue(() => {
    const path = wavePath.value.copy()
    path.lineTo(PILL_WIDTH, PILL_HEIGHT)
    path.lineTo(0, PILL_HEIGHT)
    path.close()
    return path
  })

  return (
    <Canvas pointerEvents="none" style={styles.weatherCanvas}>
      <Path path={waterPath} color={waterFillColor} />
      <Path path={wavePath} color={waterStrokeColor} style="stroke" strokeWidth={1.2} />
    </Canvas>
  )
}

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
      {icon === 'cloud-rain' && precipProbability != null ? (
        <RainWaterFill probability={precipProbability} />
      ) : null}
      {icon === 'cloud-snow' ? <Snowfall /> : null}
      <View pointerEvents="none" style={styles.content}>
        <WeatherIcon icon={icon} size={18} color={theme.control.textMuted} weight="duotone" />
        <Text style={styles.temperature}>{temperature}°</Text>
        {precipProbability != null && precipProbability > 0 ? (
          <View style={styles.precipitation}>
            <DropIcon size={9} color={theme.palette.sky.color} weight="duotone" />
            <Text style={styles.precipitationText}>{precipProbability}%</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    top: '50%',
    right: 12,
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    marginTop: -32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: theme.control.border,
    backgroundColor: theme.control.background,
    overflow: 'hidden',
  },
  weatherCanvas: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 0,
  },
  content: {
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  temperature: {
    color: theme.control.text,
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
