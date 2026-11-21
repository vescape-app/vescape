import { Canvas, Group, Path, Skia } from '@shopify/react-native-skia'
import { StyleSheet, View } from 'react-native'
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
} from 'react-native-reanimated'

import { theme } from '@/constants/theme'
import { useThemeStore } from '@/hooks/useTheme'

export interface MapPose {
  heading: number
  pitch: number
}

export function GpsPuck({
  color,
  bearing,
  mapPose,
}: {
  color: string
  bearing: SharedValue<number | null>
  mapPose: SharedValue<MapPose>
}) {
  const shadowStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: COIN_SHADOW_DROP },
      { scaleY: Math.cos(toRadians(mapPose.value.pitch)) },
    ],
  }))
  const baseStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: Math.cos(toRadians(mapPose.value.pitch)) }],
  }))
  const wallStyle = useAnimatedStyle(() => {
    const lift = COIN_HEIGHT * Math.sin(toRadians(mapPose.value.pitch))
    return { top: PUCK_CENTER - lift, height: lift }
  })
  const topStyle = useAnimatedStyle(() => {
    const pitch = toRadians(mapPose.value.pitch)
    return {
      transform: [{ translateY: -COIN_HEIGHT * Math.sin(pitch) }, { scaleY: Math.cos(pitch) }],
    }
  })
  const light = useThemeStore((state) => state.resolvedTheme === 'light')
  const shadowColor = theme.alpha(theme.palette.mono.black, coinShadowAlpha(light))
  return (
    <View style={styles.puck}>
      <Animated.View style={[styles.coinShadow, { backgroundColor: shadowColor }, shadowStyle]} />
      <Animated.View style={[styles.coinFace, { backgroundColor: color }, baseStyle]}>
        <View style={styles.wallShade} />
      </Animated.View>
      <Animated.View style={[styles.coinWall, { backgroundColor: color }, wallStyle]}>
        <View style={styles.wallShade} />
      </Animated.View>
      <GpsPuckArrow bearing={bearing} mapPose={mapPose} />
      <Animated.View
        style={[styles.coinFace, styles.coinTop, { backgroundColor: color }, topStyle]}
      />
    </View>
  )
}

function GpsPuckArrow({
  bearing,
  mapPose,
}: {
  bearing: SharedValue<number | null>
  mapPose: SharedValue<MapPose>
}) {
  const matrix = useDerivedValue(() => {
    const pitch = toRadians(mapPose.value.pitch)
    const m = Skia.Matrix()
    m.translate(PUCK_CENTER, PUCK_CENTER - COIN_HEIGHT * Math.sin(pitch))
    m.scale(1, Math.cos(pitch))
    m.rotate(toRadians((bearing.value ?? 0) - mapPose.value.heading))
    m.translate(0, -ARROW_ORBIT)
    return m
  })
  const opacity = useDerivedValue(() => (bearing.value == null ? 0 : 1))
  return (
    <Canvas style={styles.arrowCanvas} pointerEvents="none">
      <Group matrix={matrix} opacity={opacity}>
        <Path path={ARROW_PATH} color={theme.palette.mono.white} />
      </Group>
    </Canvas>
  )
}

export function coinShadowAlpha(light: boolean) {
  return light ? COIN_SHADOW_ALPHA_LIGHT : COIN_SHADOW_ALPHA_DARK
}

function toRadians(deg: number) {
  'worklet'
  return (deg * Math.PI) / 180
}

const PUCK_SIZE = 60
const PUCK_CENTER = PUCK_SIZE / 2
/**
 * @parity /node_modules/@rnmapbox/maps/android/src/main/java/com/rnmapbox/rnmbx/components/camera/RNMBXPuck.kt `COIN_RADIUS`
 * @parity /node_modules/@rnmapbox/maps/ios/RNMBX/RNMBXPuck.swift `coinRadius`
 */
const COIN_SIZE = 22
const COIN_HEIGHT = 12
const COIN_SHADOW_SIZE = 30
const COIN_SHADOW_DROP = 2
const COIN_SHADOW_ALPHA_LIGHT = 0.12
const COIN_SHADOW_ALPHA_DARK = 0.3
const ARROW_WIDTH = 18
const ARROW_LENGTH = 14
const ARROW_TUCK = 4
const ARROW_ORBIT = COIN_SIZE / 2 - ARROW_TUCK + ARROW_LENGTH / 2
const ARROW_PATH = Skia.Path.MakeFromSVGString(
  `M 0 ${-ARROW_LENGTH / 2} L ${ARROW_WIDTH / 2} ${ARROW_LENGTH / 2} L ${-ARROW_WIDTH / 2} ${ARROW_LENGTH / 2} Z`,
)!

const styles = StyleSheet.create({
  puck: {
    width: PUCK_SIZE,
    height: PUCK_SIZE,
  },
  coinShadow: {
    position: 'absolute',
    left: PUCK_CENTER - COIN_SHADOW_SIZE / 2,
    top: PUCK_CENTER - COIN_SHADOW_SIZE / 2,
    width: COIN_SHADOW_SIZE,
    height: COIN_SHADOW_SIZE,
    borderRadius: COIN_SHADOW_SIZE / 2,
  },
  coinFace: {
    position: 'absolute',
    left: PUCK_CENTER - COIN_SIZE / 2,
    top: PUCK_CENTER - COIN_SIZE / 2,
    width: COIN_SIZE,
    height: COIN_SIZE,
    borderRadius: COIN_SIZE / 2,
    overflow: 'hidden',
  },
  coinTop: {
    borderWidth: 3,
    borderColor: theme.palette.mono.white,
  },
  coinWall: {
    position: 'absolute',
    left: PUCK_CENTER - COIN_SIZE / 2,
    width: COIN_SIZE,
    overflow: 'hidden',
  },
  wallShade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.4),
  },
  arrowCanvas: {
    ...StyleSheet.absoluteFill,
  },
})
