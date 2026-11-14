import type { IconWeight } from 'phosphor-react-native'
import { type ColorValue, StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

import type { PinKindInfo } from '@/modules/group-ride/constants/riderSignalKinds'

/**
 * A pin kind's icon in its warning triangle, wherever the kind is shown: picker tile, own active
 * pin, map pin. Rider Signals and Ride Hazards share the shape; the hue tells the kinds apart.
 */
export function PinKindBadge({
  info,
  color,
  size,
  strokeWidth,
  fill = 'transparent',
  weight = 'duotone',
}: {
  info: PinKindInfo
  color: ColorValue
  /** Width and height of the triangle's box. */
  size: number
  strokeWidth: number
  fill?: ColorValue
  weight?: IconWeight
}) {
  const KindIcon = info.icon
  const { path, incenterY, inradius } = roundedTriangle(size, strokeWidth)
  const iconSize = Math.round(inradius * 1.55)
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Path d={path} fill={fill} stroke={color} strokeWidth={strokeWidth} />
      </Svg>
      <View style={[styles.icon, { top: incenterY - iconSize / 2, height: iconSize }]}>
        <KindIcon size={iconSize} color={color} weight={weight} />
      </View>
    </View>
  )
}

const CORNER_RADIUS_RATIO = 0.12

/**
 * A triangle with rounded corners filling a `side`-wide square, its base flat at the bottom so a map
 * stem drops from its middle. Returns the path and its inscribed circle, which centres the icon.
 */
function roundedTriangle(side: number, strokeWidth: number) {
  const inset = strokeWidth / 2
  const width = side - 2 * inset
  const height = width * 0.9
  const top = side - inset - height
  const corners: [number, number][] = [
    [side / 2, top],
    [side - inset, side - inset],
    [inset, side - inset],
  ]
  const radius = side * CORNER_RADIUS_RATIO
  const toward = (from: [number, number], to: [number, number]): [number, number] => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    const t = radius / length
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
  }
  const segments = corners.map((corner, i) => {
    const prev = corners[(i + 2) % 3]
    const next = corners[(i + 1) % 3]
    const [ax, ay] = toward(corner, prev)
    const [bx, by] = toward(corner, next)
    return `${i === 0 ? 'M' : 'L'}${ax},${ay} Q${corner[0]},${corner[1]} ${bx},${by}`
  })
  const slant = Math.hypot(width / 2, height)
  const inradius = (width * height) / (width + 2 * slant)
  return { path: `${segments.join(' ')} Z`, incenterY: side - inset - inradius, inradius }
}

const styles = StyleSheet.create({
  icon: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    left: 0,
    right: 0,
  },
})
