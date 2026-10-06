import { StyleSheet, View } from 'react-native'
import { Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import { TickText } from '@/components/base/TickText'
import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedTelemetryColors } from '@/hooks/useTheme'
import { BoardAttitudeIndicator } from '@/modules/board/components/BoardAttitudeIndicator'

const DIAL = 300
const RADIUS = 128
const BOARD_SIZE = 190
/** Each scale spans ± this many degrees around its axis; readings past it pin to the end. */
const SCALE_DEG = 30
const TICK_STEP = 5
const MAJOR_TICK_STEP = 15
const VALUE_SIZE = 22
/** Mono glyphs: room for "-12.3°". */
const VALUE_WIDTH = Math.ceil(VALUE_SIZE * 0.62 * 6)

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

/** The marker's rotation onto `axis` for a reading, clamped to the scale. */
function markerRotation(value: number | null, axis: number, sign: 1 | -1) {
  'worklet'
  const v = Math.max(-SCALE_DEG, Math.min(SCALE_DEG, value ?? 0))
  return [{ rotate: ((axis + sign * v) * Math.PI) / 180 }]
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
  const rollMark = useDerivedValue(() => markerRotation(roll.value, BOTTOM, -1))
  const center = DIAL / 2

  return (
    <View style={styles.wrap} testID="imu-attitude-dial">
      <Canvas style={styles.dial}>
        <Group transform={[{ translateX: center }, { translateY: center }]}>
          <Path path={RING} style="stroke" strokeWidth={1} color={ringColor} />
          <Path path={TICKS} style="stroke" strokeWidth={1} color={ringColor} />
          <Circle cx={0} cy={0} r={2} color={ringColor} />
          <Group transform={nose}>
            <Path path={MARKER} color={colors.pitch} />
          </Group>
          <Group transform={tail}>
            <Path path={MARKER} color={colors.pitch} />
          </Group>
          <Group transform={rollMark}>
            <Path path={MARKER} color={colors.roll} />
          </Group>
          {[setpointNose, setpointTail].map((transform, index) => (
            <Group key={index} transform={transform}>
              <Path
                path={SETPOINT}
                style="stroke"
                strokeWidth={1.5}
                strokeCap="round"
                strokeJoin="round"
                color={colors.balancePitch}
              />
            </Group>
          ))}
        </Group>
      </Canvas>
      <View style={styles.board} pointerEvents="none">
        <BoardAttitudeIndicator pitch={pitch} roll={roll} connected={connected} size={BOARD_SIZE} />
      </View>
      <Corner label="PITCH" value={pitch} color={colors.pitch} style={styles.topLeft} />
      <Corner
        label="BALANCE"
        value={balancePitch}
        color={colors.balancePitch}
        style={styles.topRight}
        right
      />
      <Corner label="ROLL" value={roll} color={colors.roll} style={styles.bottomLeft} />
      <Corner
        label="OFF BALANCE"
        value={offBalance}
        color={offColor}
        style={styles.bottomRight}
        right
      />
    </View>
  )
}

interface CornerProps {
  label: string
  value: SharedValue<number | null>
  color: string
  style: object
  right?: boolean
}

function Corner({ label, value, color, style, right }: CornerProps) {
  return (
    <View style={[styles.corner, right && styles.cornerRight, style]}>
      <Text style={styles.label}>{label}</Text>
      <TickText
        value={value}
        decimals={1}
        unit="°"
        size={VALUE_SIZE}
        weight="800"
        color={color}
        align={right ? 'right' : 'left'}
        width={VALUE_WIDTH}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    height: DIAL + 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dial: {
    width: DIAL,
    height: DIAL,
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
