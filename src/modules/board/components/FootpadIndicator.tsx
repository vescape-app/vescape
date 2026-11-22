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
import {
  Easing,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import { MonoText } from '@/components/base/MonoValue'
import { theme } from '@/constants/theme'
import { useResolvedColor } from '@/hooks/useTheme'
import { HUD_IDLE_GLYPH_COLOR } from '@/modules/board/constants/telemetry'
import { FOOTPAD_FALLBACK_THRESHOLD_V } from '@/modules/board/store/boardConfigValuesStore'

const DISABLED_COLOR = theme.alpha(theme.palette.slate.textDim, 0.12)

const CENTER_COLOR = theme.alpha(theme.palette.slate.textDim, 0.1)
const CENTER_DASH = [3, 4]

const VALUE_COLOR = theme.palette.slate.textDim
const VALUE_SIZE = 13
const VALUE_GUTTER_CHARS = 3.6
const VALUE_PAD = 8

const GLOW_WIDTH_FACTOR = 5
const GLOW_OPACITY = 0.35

const FILL_EASE = { duration: 120, easing: Easing.out(Easing.quad) }

const FOOTPAD_ASPECT = 22 / 25

interface FootpadGeometry {
  interior: SkPath
  center: SkPath
  left: SkPath
  right: SkPath
  width: number
  height: number
  stroke: number
}

type FootpadBase = Pick<FootpadGeometry, 'width' | 'height' | 'stroke'>

function railBox(g: FootpadBase) {
  const inset = g.stroke / 2
  const x0 = inset
  const x1 = g.width - inset
  const y0 = inset
  const y1 = g.height - inset
  const span = x1 - x0
  return { x0, x1, y0, y1, cx: g.width / 2, corner: span * 0.22, gap: span * 0.06 }
}

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
  end: SharedValue<number>
  glow: SharedValue<number>
  disabled: boolean
}

function useZoneDrive(value: SharedValue<number | null>, threshold: number | null): ZoneDrive {
  'use no memo'
  const engageAt = threshold ?? FOOTPAD_FALLBACK_THRESHOLD_V
  const disabled = engageAt <= 0
  const target = useDerivedValue(() => {
    if (disabled) return 0
    const adc = value.value
    if (adc == null || adc <= 0) return 0
    return Math.min(1, adc / engageAt)
  })
  const end = useSharedValue(0)
  useAnimatedReaction(
    () => target.value,
    (next) => {
      // eslint-disable-next-line react-hooks/immutability
      end.value = withTiming(next, FILL_EASE)
    },
  )
  const glow = useDerivedValue<number>(() => (target.value >= 1 ? GLOW_OPACITY : 0))
  return { end, glow, disabled }
}

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
  fillColor: string
}

interface FootpadGlowProps extends FootpadZoneProps {
  glow: SharedValue<number>
}

function FootpadZone({ path, stroke, drive, fillColor }: FootpadZoneProps) {
  return (
    <>
      <Path
        path={path}
        style="stroke"
        strokeWidth={stroke}
        strokeCap="round"
        strokeJoin="round"
        color={drive.disabled ? DISABLED_COLOR : HUD_IDLE_GLYPH_COLOR}
      />
      <Path
        path={path}
        style="stroke"
        strokeWidth={stroke}
        strokeCap="round"
        strokeJoin="round"
        color={fillColor}
        start={0}
        end={drive.end}
      />
    </>
  )
}

function FootpadGlow({ path, stroke, glow, fillColor }: FootpadGlowProps) {
  return (
    <Path
      path={path}
      style="stroke"
      strokeWidth={stroke * GLOW_WIDTH_FACTOR}
      strokeCap="round"
      strokeJoin="round"
      color={fillColor}
      opacity={glow}
    >
      <BlurMask blur={stroke * GLOW_WIDTH_FACTOR} style="normal" />
    </Path>
  )
}

export interface FootpadIndicatorProps {
  adc1: SharedValue<number | null>
  adc2: SharedValue<number | null>
  threshold1: number | null
  threshold2: number | null
  width?: number
  showValues?: boolean
  posi?: boolean
  style?: ViewStyle
  testID?: string
}

export function FootpadIndicator({
  adc1,
  adc2,
  threshold1,
  threshold2,
  width = 26,
  showValues = false,
  posi = false,
  style,
  testID,
}: FootpadIndicatorProps) {
  'use no memo'
  const fillColor = useResolvedColor(theme.palette.green.text)
  const geometry = useMemo(() => buildGeometry(width), [width])
  const left = useZoneDrive(adc2, threshold2)
  const right = useZoneDrive(adc1, threshold1)
  const sharedGlow = useDerivedValue<number>(() => Math.max(left.glow.value, right.glow.value))
  const leftGlow = posi ? sharedGlow : left.glow
  const rightGlow = posi ? sharedGlow : right.glow
  const gutter = showValues ? VALUE_SIZE * VALUE_GUTTER_CHARS : 0
  const leftText = useVoltsText(adc2)
  const rightText = useVoltsText(adc1)

  return (
    <View style={style} testID={testID}>
      <Canvas style={{ width: geometry.width + gutter * 2, height: geometry.height }}>
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
            <FootpadGlow
              path={geometry.left}
              stroke={geometry.stroke}
              drive={left}
              glow={leftGlow}
              fillColor={fillColor}
            />
            <FootpadGlow
              path={geometry.right}
              stroke={geometry.stroke}
              drive={right}
              glow={rightGlow}
              fillColor={fillColor}
            />
          </Group>
          <FootpadZone
            path={geometry.left}
            stroke={geometry.stroke}
            drive={left}
            fillColor={fillColor}
          />
          <FootpadZone
            path={geometry.right}
            stroke={geometry.stroke}
            drive={right}
            fillColor={fillColor}
          />
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
