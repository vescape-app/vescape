import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, View, type ColorValue } from 'react-native'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import type { Icon } from 'phosphor-react-native'

import { theme } from '@/constants/theme'

export const BROADCAST_WAVE_MS = 1600
export const RING_START = 0.3
const BROADCAST_PARTS = [
  'M128 96a32 32 0 1 0 0 64a32 32 0 1 0 0 -64',
  'M181.5 74.5A76 76 0 0 1 181.5 181.5M74.5 181.5A76 76 0 0 1 74.5 74.5',
  'M213 44A120 120 0 0 1 213 212M43 212A120 120 0 0 1 43 44',
] as const
const STROKE = { regular: 16, bold: 24 } as const

export function BroadcastGlyph({
  size,
  color,
  wave,
  pulsing,
  connecting = false,
  weight = 'regular',
}: {
  size: number
  color: ColorValue
  wave: SharedValue<number>
  pulsing: boolean
  connecting?: boolean
  weight?: keyof typeof STROKE
}) {
  return (
    <View style={{ width: size, height: size }}>
      {connecting ? <ActivityIndicator style={StyleSheet.absoluteFill} color={color} /> : null}
      {connecting
        ? null
        : BROADCAST_PARTS.map((d, index) => (
            <BroadcastPart
              key={d}
              d={d}
              index={index}
              size={size}
              color={color}
              wave={wave}
              pulsing={pulsing}
              strokeWidth={STROKE[weight]}
            />
          ))}
    </View>
  )
}

export const PulsingBroadcastIcon = PulsingBroadcast as unknown as Icon

function PulsingBroadcast({
  size = 24,
  color = theme.control.icon,
  weight,
}: {
  size?: number
  color?: ColorValue
  weight?: string
}) {
  const wave = useSharedValue(0)
  useEffect(() => {
    wave.set(withRepeat(withTiming(1, { duration: BROADCAST_WAVE_MS }), -1, false))
    return () => cancelAnimation(wave)
  }, [wave])
  return (
    <BroadcastGlyph
      size={size}
      color={color}
      wave={wave}
      pulsing
      weight={weight === 'bold' ? 'bold' : 'regular'}
    />
  )
}

function BroadcastPart({
  d,
  index,
  size,
  color,
  wave,
  pulsing,
  strokeWidth,
}: {
  d: string
  index: number
  size: number
  color: ColorValue
  wave: SharedValue<number>
  pulsing: boolean
  strokeWidth: number
}) {
  const style = useAnimatedStyle(() => {
    if (!pulsing) return { opacity: 1 }
    const t = wave.get()
    const step = RING_START / BROADCAST_PARTS.length
    const rise = Math.min(1, Math.max(0, (t - index * step) / step))
    const fall = Math.min(1, Math.max(0, (1 - t) / 0.3))
    return { opacity: 0.5 + Math.min(rise, fall) * 0.5 }
  })
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width={size} height={size} viewBox="0 0 256 256">
        <Path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  )
}
