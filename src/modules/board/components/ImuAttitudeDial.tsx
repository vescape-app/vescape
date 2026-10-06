import { useState } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import { TickText } from '@/components/base/TickText'
import { theme } from '@/constants/theme'
import { textAdvanceWidth } from '@/helpers/skiaText'
import { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { useResolvedColor, useResolvedTelemetryColors } from '@/hooks/useTheme'
import { BoardAttitudeIndicator } from '@/modules/board/components/BoardAttitudeIndicator'

/** Drawing size at full scale; narrower screens scale the whole dial down. */
const DIAL = 300
/** Kept free on each side of the dial for the corner readings to sit beside the ring. */
const SIDE_ROOM = 30
const RADIUS = 128
const BOARD_SIZE = 190
/** Each scale spans ± this many degrees around its axis; readings past it pin to the end. */
const SCALE_DEG = 30
const TICK_STEP = 5
const MAJOR_TICK_STEP = 15
const VALUE_SIZE = 22
const VALUE_WEIGHT = '800'
/** The widest reading a corner shows, measured to size its box. */
const WIDEST_VALUE = '-00.0°'

/** Where each scale sits on the ring, in degrees clockwise from 3 o'clock. */
const NOSE = 0
const TAIL = 180
const BOTTOM = 90

function buildTicks() {
  const path = Skia.Path.Make()
  for (const axis of [NOSE, TAIL, BOTTOM]) {
    for (let d = -SCALE_DEG; d <= SCALE_DEG; d += TICK_STEP) {
      const rad = ((axis + d) * Math.PI) / 180
      const length = d % MAJOR_TICK_STEP === 0 ? 9 : 4
      path.moveTo(Math.cos(rad) * RADIUS, Math.sin(rad) * RADIUS)
      path.lineTo(Math.cos(rad) * (RADIUS - length), Math.sin(rad) * (RADIUS - length))
    }
  }
  return path
}

function buildRing() {
  const path = Skia.Path.Make()
  path.addCircle(0, 0, RADIUS)
  return path
}

/** A small triangle just outside the ring at 3 o'clock, pointing in; rotated onto its reading. */
function buildMarker() {
  const path = Skia.Path.Make()
  path.moveTo(RADIUS + 2, 0)
  path.lineTo(RADIUS + 12, -6)
  path.lineTo(RADIUS + 12, 6)
  path.close()
  return path
}

/** An open chevron just inside the ticks at 3 o'clock, pointing out at the ring: the setpoint sits
 * on the inside so it never hides the pitch mark outside. */
function buildSetpoint() {
  const path = Skia.Path.Make()
  path.moveTo(RADIUS - 20, -6)
  path.lineTo(RADIUS - 13, 0)
  path.lineTo(RADIUS - 20, 6)
  return path
}

const TICKS = buildTicks()
const RING = buildRing()
const MARKER = buildMarker()
const SETPOINT = buildSetpoint()

/** The marker's rotation onto `axis` for a reading, clamped to the scale. A missing reading parks
 * it at zero, where `markerOpacity` hides it. */
function markerRotation(value: number | null, axis: number, sign: 1 | -1) {
  'worklet'
  const v = Math.max(-SCALE_DEG, Math.min(SCALE_DEG, value ?? 0))
  return [{ rotate: ((axis + sign * v) * Math.PI) / 180 }]
}

/** Hidden without a reading, so no data never reads as a level board. */
function markerOpacity(value: number | null) {
  'worklet'
  return value == null ? 0 : 1
}

interface ImuAttitudeDialProps {
  pitch: SharedValue<number | null>
  roll: SharedValue<number | null>
  balancePitch: SharedValue<number | null>
  connected: boolean
}

/**
 * Pitch, roll and the balance setpoint read off one ring around the live 3D board. Pitch marks the
 * side arcs, where the nose and tail point; roll marks the bottom arc; the balance setpoint is a
 * chevron inside the ring at both ends, so the gap between it and the pitch mark is how far off
 * balance the board sits. Each corner value takes its mark's colour, which is also its chart's.
 */
export function ImuAttitudeDial({ pitch, roll, balancePitch, connected }: ImuAttitudeDialProps) {
  'use no memo'
  const colors = useResolvedTelemetryColors()
  const offColor = useResolvedColor(theme.palette.pink.color)
  const ringColor = useResolvedColor(theme.alpha(theme.palette.slate.textDim, 0.4))
  const offBalance = useDerivedValue(() => {
    const p = pitch.value
    const b = balancePitch.value
    return p == null || b == null ? null : p - b
  })
  const nose = useDerivedValue(() => markerRotation(pitch.value, NOSE, 1))
  const tail = useDerivedValue(() => markerRotation(pitch.value, TAIL, 1))
  const setpointNose = useDerivedValue(() => markerRotation(balancePitch.value, NOSE, 1))
  const setpointTail = useDerivedValue(() => markerRotation(balancePitch.value, TAIL, 1))
  // Counter-clockwise on the bottom arc, so positive roll moves the mark right and negative left,
  // reading like a level gauge rather than swinging against it.
  const rollMark = useDerivedValue(() => markerRotation(roll.value, BOTTOM, -1))
  const pitchShown = useDerivedValue(() => markerOpacity(pitch.value))
  const rollShown = useDerivedValue(() => markerOpacity(roll.value))
  const setpointShown = useDerivedValue(() => markerOpacity(balancePitch.value))
  const [width, setWidth] = useState(DIAL + 2 * SIDE_ROOM)
  const size = Math.min(DIAL, width - 2 * SIDE_ROOM)
  const scale = size / DIAL
  const valueFont = useSkiaMonoFont(VALUE_WEIGHT, VALUE_SIZE)
  const valueWidth = valueFont ? Math.ceil(textAdvanceWidth(valueFont, WIDEST_VALUE)) : 0

  return (
    <View
      style={[styles.wrap, { height: size + 20 }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      testID="imu-attitude-dial"
    >
      <Canvas style={{ width: size, height: size }}>
        <Group transform={[{ translateX: size / 2 }, { translateY: size / 2 }, { scale }]}>
          <Path path={RING} style="stroke" strokeWidth={1} color={ringColor} />
          <Path path={TICKS} style="stroke" strokeWidth={1} color={ringColor} />
          <Circle cx={0} cy={0} r={2} color={ringColor} />
          <Group opacity={pitchShown}>
            <Group transform={nose}>
              <Path path={MARKER} color={colors.pitch} />
            </Group>
            <Group transform={tail}>
              <Path path={MARKER} color={colors.pitch} />
            </Group>
          </Group>
          <Group transform={rollMark} opacity={rollShown}>
            <Path path={MARKER} color={colors.roll} />
          </Group>
          <Group
            opacity={setpointShown}
            style="stroke"
            strokeWidth={1.5}
            strokeCap="round"
            strokeJoin="round"
            color={colors.balancePitch}
          >
            <Group transform={setpointNose}>
              <Path path={SETPOINT} />
            </Group>
            <Group transform={setpointTail}>
              <Path path={SETPOINT} />
            </Group>
          </Group>
        </Group>
      </Canvas>
      <View style={styles.board} pointerEvents="none">
        <BoardAttitudeIndicator
          pitch={pitch}
          roll={roll}
          connected={connected}
          size={BOARD_SIZE * scale}
        />
      </View>
      <Corner
        label="PITCH"
        value={pitch}
        color={colors.pitch}
        valueWidth={valueWidth}
        style={styles.topLeft}
      />
      <Corner
        label="BALANCE"
        value={balancePitch}
        color={colors.balancePitch}
        valueWidth={valueWidth}
        style={styles.topRight}
        align="right"
      />
      <Corner
        label="ROLL"
        value={roll}
        color={colors.roll}
        valueWidth={valueWidth}
        style={styles.bottomLeft}
      />
      <Corner
        label="OFF BALANCE"
        value={offBalance}
        color={offColor}
        valueWidth={valueWidth}
        style={styles.bottomRight}
        align="right"
      />
    </View>
  )
}

interface CornerProps {
  label: string
  value: SharedValue<number | null>
  color: string
  valueWidth: number
  style: StyleProp<ViewStyle>
  align?: 'left' | 'right'
}

function Corner({ label, value, color, valueWidth, style, align = 'left' }: CornerProps) {
  return (
    <View style={[styles.corner, align === 'right' && styles.cornerRight, style]}>
      <Text style={styles.label}>{label}</Text>
      <TickText
        value={value}
        decimals={1}
        unit="°"
        size={VALUE_SIZE}
        weight={VALUE_WEIGHT}
        color={color}
        align={align}
        width={valueWidth}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  board: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: {
    position: 'absolute',
    gap: 2,
  },
  cornerRight: {
    alignItems: 'flex-end',
  },
  topLeft: { top: 0, left: 0 },
  topRight: { top: 0, right: 0 },
  bottomLeft: { bottom: 0, left: 0 },
  bottomRight: { bottom: 0, right: 0 },
  label: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
})
