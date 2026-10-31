import { Canvas, Path, Skia } from '@shopify/react-native-skia'
import { ClockCounterClockwiseIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View } from 'react-native'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { interaction, theme } from '@/constants/theme'
import { rideDistanceFromMeters } from '@/helpers/units'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import { useResolvedAccentColors, useResolvedColor } from '@/hooks/useTheme'
import { useTodayStats } from '@/modules/profile/hooks/useTodayStats'

/** Matches IconButton size `lg`. */
const DIM = 54
const STROKE = 1.5
const PILL_W = 32
const PILL_H = 80
/** Radius of the inverted corner where the pill meets the button. */
const FILLET_R = 8

/**
 * One continuous outline of true circular arcs: a pill flush with the button's left edge. Its left
 * side runs straight into the circle's tangent; its right side meets the circle through an inverted
 * corner. Drawn as a single path so the border never crosses itself.
 */
function outlinePath() {
  const pad = STROKE / 2
  const pr = PILL_W / 2
  const r = DIM / 2 - pad
  const cx = DIM / 2
  const cy = PILL_H + DIM / 2
  const right = PILL_W - pad
  // Inverted corner: a circle tangent to the pill's right side and to the button from outside.
  const fcx = right + FILLET_R
  const reach = r + FILLET_R
  const fcy = cy - Math.sqrt(reach * reach - (fcx - cx) * (fcx - cx))
  const tx = cx + (r * (fcx - cx)) / reach
  const ty = cy + (r * (fcy - cy)) / reach
  const svg = [
    `M ${pad} ${pad + pr}`,
    `A ${pr - pad} ${pr - pad} 0 0 1 ${right} ${pad + pr}`,
    `L ${right} ${fcy}`,
    `A ${FILLET_R} ${FILLET_R} 0 0 0 ${tx} ${ty}`,
    `A ${r} ${r} 0 1 1 ${pad} ${cy}`,
    'Z',
  ].join(' ')
  return Skia.Path.MakeFromSVGString(svg)
}

const OUTLINE = outlinePath()

interface HistoryButtonProps {
  onPress: () => void
}

/** Opens History. After a ride today it grows a tab above it showing the day's distance. */
export function HistoryButton({ onPress }: HistoryButtonProps) {
  const today = useTodayStats()
  const distanceUnit = useDistanceUnit()
  const accent = useResolvedAccentColors()
  const fill = useResolvedColor(theme.control.background)
  const riding = today.rideCount > 0 && OUTLINE !== null

  if (!riding) {
    return (
      <IconButton
        icon={ClockCounterClockwiseIcon}
        size="lg"
        onPress={onPress}
        testID="history-button"
      />
    )
  }

  const distance = rideDistanceFromMeters(today.distanceM ?? 0, distanceUnit).toFixed(1)
  const minutes = today.rideTimeMs / 60_000
  // Under an hour, whole minutes read better than `0.4 h`.
  const [time, timeUnit] =
    minutes < 60 ? [Math.round(minutes), 'min'] : [(minutes / 60).toFixed(1), 'h']

  return (
    <View>
      <Canvas pointerEvents="none" style={styles.outline}>
        <Path path={OUTLINE} color={fill} />
        <Path path={OUTLINE} style="stroke" strokeWidth={STROKE} color={accent.sky.border} />
      </Canvas>
      <Pressable
        testID="history-today-distance"
        accessibilityLabel={`Today ${distance} ${distanceUnit}, ${time} ${timeUnit}`}
        onPress={onPress}
        style={({ pressed }) => [styles.pill, pressed && { opacity: interaction.pressedOpacity }]}
      >
        <Text numberOfLines={1} adjustsFontSizeToFit style={styles.distance}>
          {distance}
        </Text>
        <Text style={styles.unit}>{distanceUnit}</Text>
        <View style={styles.divider} />
        <Text numberOfLines={1} adjustsFontSizeToFit style={styles.distance}>
          {time}
        </Text>
        <Text style={styles.unit}>{timeUnit}</Text>
      </Pressable>
      <IconButton
        icon={ClockCounterClockwiseIcon}
        size="lg"
        onPress={onPress}
        testID="history-button"
        style={styles.bareButton}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  outline: {
    position: 'absolute',
    left: 0,
    top: -PILL_H,
    width: DIM,
    height: PILL_H + DIM,
  },
  pill: {
    position: 'absolute',
    left: 0,
    top: -PILL_H,
    width: PILL_W,
    height: PILL_H,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
  },
  distance: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: theme.control.text,
    fontSize: 14,
    fontWeight: '800',
  },
  unit: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: theme.control.textMuted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: -3,
  },
  divider: {
    width: 14,
    height: StyleSheet.hairlineWidth,
    marginVertical: 5,
    backgroundColor: theme.control.divider,
  },
  bareButton: {
    borderColor: theme.alpha(theme.palette.mono.black, 0),
    backgroundColor: theme.alpha(theme.palette.mono.black, 0),
  },
})
