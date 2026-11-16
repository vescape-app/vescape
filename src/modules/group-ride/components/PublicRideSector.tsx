import { G, Path, RadialGradient, Stop } from 'react-native-svg'
import Animated, {
  useAnimatedProps,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import type { PublicRideReadoutState } from '@/modules/group-ride/components/PublicRideReadout'
import { PUBLIC_RIDE_ARC, type publicRideSector } from '@/modules/group-ride/lib/publicRideArc'

const AnimatedG = Animated.createAnimatedComponent(G)

export function PublicRideSector({
  sector,
  index,
  readout,
  surface,
  border,
  accent,
  gradientId,
  initialActive,
}: {
  initialActive: boolean
  sector: ReturnType<typeof publicRideSector>
  index: number
  readout: SharedValue<PublicRideReadoutState>
  surface: string
  border: string
  accent: string
  gradientId: string
}) {
  const opacity = useSharedValue(initialActive ? 1 : 0)
  useAnimatedReaction(
    () => readout.get().sector === index,
    (active, previous) => {
      if (active !== previous) opacity.set(withTiming(active ? 1 : 0, { duration: 80 }))
    },
  )
  const props = useAnimatedProps(() => ({ opacity: opacity.get() }))
  return (
    <>
      <Path d={sector.path} fill={surface} stroke={border} strokeWidth={1} />
      {index !== 1 ? (
        <AnimatedG animatedProps={props}>
          <Path d={sector.path} fill={`url(#${gradientId})`} />
          <Path d={sector.outerPath} fill="none" stroke={accent} strokeWidth={3} />
        </AnimatedG>
      ) : null}
    </>
  )
}

export function PublicRideSectorGradient({ id, color }: { id: string; color: string }) {
  const { cx, cy, innerRadius, outerRadius } = PUBLIC_RIDE_ARC
  return (
    <RadialGradient
      id={id}
      cx={cx}
      cy={cy}
      rx={outerRadius}
      ry={outerRadius}
      gradientUnits="userSpaceOnUse"
    >
      <Stop offset={innerRadius / outerRadius} stopColor={color} stopOpacity={0} />
      <Stop offset={0.83} stopColor={color} stopOpacity={0.08} />
      <Stop offset={0.96} stopColor={color} stopOpacity={0.16} />
      <Stop offset={1} stopColor={color} stopOpacity={0.32} />
    </RadialGradient>
  )
}
