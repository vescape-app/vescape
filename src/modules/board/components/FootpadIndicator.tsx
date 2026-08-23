import { useMemo } from 'react'
import { View, type ViewStyle } from 'react-native'
import {
  BlurMask,
  Canvas,
  DashPathEffect,
  Group,
  Path,
  Skia,
  type SkPath,
} from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { MonoText } from '@/components/base/MonoValue'
import { theme } from '@/constants/theme'
import { FOOTPAD_FALLBACK_THRESHOLD_V } from '@/modules/board/store/boardConfigValuesStore'

const TRACK_COLOR = theme.alpha(theme.palette.slate.textDim, 0.4)
const FILL_COLOR = theme.palette.green.text
/** Disabled zone (`fault_adc = 0`): the rail is still drawn so the pad keeps its shape, but muted. */
const DISABLED_COLOR = theme.alpha(theme.palette.slate.textDim, 0.12)

/** The seam between the zones: present enough to place the two rails, quiet enough to ignore. */
const CENTER_COLOR = theme.alpha(theme.palette.slate.textDim, 0.1)
const CENTER_DASH = [3, 4]

const VALUE_COLOR = theme.palette.slate.textDim
const VALUE_SIZE = 13
/** Gutter as a multiple of the glyph size — `0.00V` plus a little air on each side. */
const VALUE_GUTTER_CHARS = 3.6
const VALUE_PAD = 8

/** How much of the rail's own width the glow spreads to, once the zone engages. */
const GLOW_WIDTH_FACTOR = 5
const GLOW_OPACITY = 0.35

/** A real Onewheel pad is 25cm × 22cm; the drawing keeps that ratio so it reads as the same object. */
const FOOTPAD_ASPECT = 22 / 25

interface FootpadGeometry {
  /** Closed pad area, never stroked — it only clips the glow to the inside of the pad. */
  interior: SkPath
  /** The seam between the two zones. */
  center: SkPath
  left: SkPath
  right: SkPath
  width: number
  height: number
  stroke: number
}

type FootpadBase = Pick<FootpadGeometry, 'width' | 'height' | 'stroke'>

/**
 * The pad outline in canvas coordinates: chamfered top corners, open sides, no bottom edge, and a
 * gap at top center where the two zones meet.
 */
function railBox(g: FootpadBase) {
  const inset = g.stroke / 2
  const x0 = inset
  const x1 = g.width - inset
  const y0 = inset
  const y1 = g.height - inset
  const span = x1 - x0
  return { x0, x1, y0, y1, cx: g.width / 2, corner: span * 0.22, gap: span * 0.06 }
}

/**
 * One sensor zone's rail: up the side, over the top corner, in toward center.
 *
 * The direction matters, because the rail is filled by trimming it: the fill grows from the bottom
 * of the side upward and then inward, so a full rail reads as a foot covering the whole zone rather
 * than as a bar that happens to be long.
 */
function buildRail(g: FootpadBase, side: -1 | 1): SkPath {
  const { x0, x1, y0, y1, cx, corner, gap } = railBox(g)
  const edgeX = side < 0 ? x0 : x1
  const path = Skia.Path.Make()
  path.moveTo(edgeX, y1)
  path.lineTo(edgeX, y0 + corner)
  path.quadTo(edgeX, y0, edgeX - side * corner, y0)
  path.lineTo(cx + side * gap, y0)
  return path
}

function buildInterior(g: FootpadBase): SkPath {
  const { x0, x1, y0, y1, corner } = railBox(g)
  const path = Skia.Path.Make()
  path.moveTo(x0, y1)
  path.lineTo(x0, y0 + corner)
  path.quadTo(x0, y0, x0 + corner, y0)
  path.lineTo(x1 - corner, y0)
  path.quadTo(x1, y0, x1, y0 + corner)
  path.lineTo(x1, y1)
  path.close()
  return path
}

function buildCenterLine(g: FootpadBase): SkPath {
  const { y0, y1, cx } = railBox(g)
  const path = Skia.Path.Make()
  path.moveTo(cx, y0)
  path.lineTo(cx, y1)
  return path
}

function buildGeometry(width: number): FootpadGeometry {
  // One hairline-ish weight at every size, like the rest of the app's line work.
  const base = { width, height: width * FOOTPAD_ASPECT, stroke: 1.5 }
  return {
    ...base,
    interior: buildInterior(base),
    center: buildCenterLine(base),
    left: buildRail(base, -1),
    right: buildRail(base, 1),
  }
}

interface ZoneDrive {
  /** Trim end of the fill rail, `0…1`. Reaching `1` is exactly the zone engaging. */
  end: SharedValue<number>
  /** Glow opacity — `0` until the zone engages, so "full" is unmistakable at strip size. */
  glow: SharedValue<number>
  disabled: boolean
}

/**
 * Drive one zone's rail from its live ADC reading against its own configured engagement voltage.
 * The zones can be configured differently, so neither may borrow the other's number.
 *
 * The threshold is a plain number captured into the worklets. These run on the UI thread on every
 * telemetry frame (~31Hz); reading a store inside them would put a subscription in the hot path.
 */
function useZoneDrive(value: SharedValue<number | null>, threshold: number | null): ZoneDrive {
  'use no memo'
  // No config yet (first connection, read not landed, no cache) falls back silently — the gap is
  // seconds, and a loading state on an indicator this small would be worse than a slightly wrong
  // scale.
  const engageAt = threshold ?? FOOTPAD_FALLBACK_THRESHOLD_V
  // `fault_adc = 0` disables that zone's switch outright: it can never engage, so the rail stays
  // empty for the whole session. The `footpad-disabled` Board Warning carries the explanation.
  const disabled = engageAt <= 0
  const end = useDerivedValue(() => {
    if (disabled) return 0
    const adc = value.value
    if (adc == null || adc <= 0) return 0
    return Math.min(1, adc / engageAt)
  })
  const glow = useDerivedValue<number>(() => (end.value >= 1 ? GLOW_OPACITY : 0))
  return { end, glow, disabled }
}

/** One zone's live voltage as text, off the UI thread — a dash until the board is sending. */
function useVoltsText(value: SharedValue<number | null>) {
  'use no memo'
  return useDerivedValue(() => {
    const adc = value.value
    return adc == null ? '—' : `${adc.toFixed(2)}V`
  })
}

interface FootpadZoneProps {
  path: SkPath
  stroke: number
  drive: ZoneDrive
}

function FootpadZone({ path, stroke, drive }: FootpadZoneProps) {
  return (
    <>
      <Path
        path={path}
        style="stroke"
        strokeWidth={stroke}
        strokeCap="round"
        strokeJoin="round"
        color={drive.disabled ? DISABLED_COLOR : TRACK_COLOR}
      />
      {/* Trimming is geometry per frame, which the canvas rules normally forbid — but the fill runs
          along a curve that turns a corner, so no transform or linear clip can express it, and it
          is two short contours rather than a chart's worth of points. */}
      <Path
        path={path}
        style="stroke"
        strokeWidth={stroke}
        strokeCap="round"
        strokeJoin="round"
        color={FILL_COLOR}
        start={0}
        end={drive.end}
      />
    </>
  )
}

/**
 * The engaged zone's glow, spilling only into the pad. It is clipped to the interior so the light
 * reads as the pad lighting up under the foot, rather than as a halo around a line.
 */
function FootpadGlow({ path, stroke, drive }: FootpadZoneProps) {
  return (
    <Path
      path={path}
      style="stroke"
      strokeWidth={stroke * GLOW_WIDTH_FACTOR}
      strokeCap="round"
      strokeJoin="round"
      color={FILL_COLOR}
      opacity={drive.glow}
    >
      <BlurMask blur={stroke * GLOW_WIDTH_FACTOR} style="normal" />
    </Path>
  )
}

export interface FootpadIndicatorProps {
  /** Live ADC volts for each sensor zone, straight off the telemetry tick. */
  adc1: SharedValue<number | null>
  adc2: SharedValue<number | null>
  /** `fault_adc1` / `fault_adc2` in volts; `null` when no board config is available, `0` disabled. */
  threshold1: number | null
  threshold2: number | null
  /** Pad width in points; height follows the footpad's own proportions. */
  width?: number
  /** Draw each zone's live voltage beside its rail. Only legible at detail size. */
  showValues?: boolean
  style?: ViewStyle
  testID?: string
}

/**
 * The footpad as a footpad: one Onewheel-shaped pad with a rail down each side, each rail filling
 * with its zone's ADC reading and full exactly when that zone engages.
 *
 * It replaces two dots, which suggested two independent switches placed side by side. There is one
 * pad, read by two sensors under its edges, and a rider standing badly loads one edge — the shape
 * has to show that.
 */
export function FootpadIndicator({
  adc1,
  adc2,
  threshold1,
  threshold2,
  width = 26,
  showValues = false,
  style,
  testID,
}: FootpadIndicatorProps) {
  'use no memo'
  const geometry = useMemo(() => buildGeometry(width), [width])
  const left = useZoneDrive(adc1, threshold1)
  const right = useZoneDrive(adc2, threshold2)
  const gutter = showValues ? VALUE_SIZE * VALUE_GUTTER_CHARS : 0
  const leftText = useVoltsText(adc1)
  const rightText = useVoltsText(adc2)

  return (
    <View style={style} testID={testID}>
      <Canvas style={{ width: geometry.width + gutter * 2, height: geometry.height }}>
        {/* Clip nested inside the transform, never on it: a clip on a transformed node is evaluated
            in the transformed space. */}
        <Group transform={[{ translateX: gutter }]}>
          <Path
            path={geometry.center}
            style="stroke"
            strokeWidth={geometry.stroke}
            color={CENTER_COLOR}
          >
            <DashPathEffect intervals={CENTER_DASH} />
          </Path>
          <Group clip={geometry.interior}>
            <FootpadGlow path={geometry.left} stroke={geometry.stroke} drive={left} />
            <FootpadGlow path={geometry.right} stroke={geometry.stroke} drive={right} />
          </Group>
          <FootpadZone path={geometry.left} stroke={geometry.stroke} drive={left} />
          <FootpadZone path={geometry.right} stroke={geometry.stroke} drive={right} />
        </Group>
        {showValues ? (
          <>
            <MonoText
              text={leftText}
              size={VALUE_SIZE}
              color={VALUE_COLOR}
              align="right"
              x={0}
              width={gutter - VALUE_PAD}
              height={geometry.height}
            />
            <MonoText
              text={rightText}
              size={VALUE_SIZE}
              color={VALUE_COLOR}
              x={gutter + geometry.width + VALUE_PAD}
              width={gutter}
              height={geometry.height}
            />
          </>
        ) : null}
      </Canvas>
    </View>
  )
}
