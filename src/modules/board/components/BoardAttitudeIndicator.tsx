import { useMemo } from 'react'
import { Canvas, Group, Path, Skia, type SkPath } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { theme } from '@/constants/theme'
import { useResolvedColor } from '@/hooks/useTheme'
import { HUD_IDLE_GLYPH_COLOR } from '@/modules/board/constants/telemetry'
import {
  ATTITUDE_EXTENT,
  boardAttitudePose,
  TIRE_HALF_WIDTH,
  TIRE_RADIUS,
} from '@/modules/board/lib/boardAttitudeGeometry'

function polygon(points: number[][]): SkPath {
  const path = Skia.Path.Make()
  path.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) path.lineTo(points[i][0], points[i][1])
  path.close()
  return path
}

function deck(outerX: number): SkPath {
  const path = polygon([
    [-outerX, -64],
    [-89, -64],
    [-89, 64],
    [-outerX, 64],
  ])
  path.addPath(
    polygon([
      [89, -64],
      [outerX, -64],
      [outerX, 64],
      [89, 64],
    ]),
  )
  return path
}

function buildPaths() {
  const tire = Skia.Path.Make()
  tire.addCircle(0, 0, TIRE_RADIUS)
  const farArc = Skia.Path.Make()
  farArc.addArc({ x: -78, y: -78, width: 156, height: 156 }, 180, 180)
  const treadSides = Skia.Path.Make()
  for (const x of [-TIRE_RADIUS, TIRE_RADIUS]) {
    treadSides.moveTo(x, -TIRE_HALF_WIDTH)
    treadSides.lineTo(x, TIRE_HALF_WIDTH)
  }
  const edgeOn = Skia.Path.Make()
  for (const [halfLength, halfWidth] of [
    [218, 64],
    [78, 43],
  ]) {
    for (const y of [-halfWidth, halfWidth]) {
      edgeOn.moveTo(-halfLength, y)
      edgeOn.lineTo(halfLength, y)
    }
  }
  return {
    edgeOn,
    rail: polygon([
      [-218, 12],
      [218, 12],
      [197, -12],
      [-197, -12],
    ]),
    top: deck(218),
    bottom: deck(197),
    cap: polygon([
      [0, -64],
      [21, -64],
      [21, 64],
      [0, 64],
    ]),
    tire,
    farArc,
    treadSides,
    tread: polygon([
      [-78, -43],
      [78, -43],
      [78, 43],
      [-78, 43],
    ]),
  }
}

/** Erase only this canvas's earlier lines; the map remains visible through the solid outline. */
function SolidOutline({ path, color, stroke }: { path: SkPath; color: string; stroke: number }) {
  return (
    <>
      <Path path={path} blendMode="dstOut" />
      <Path path={path} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
    </>
  )
}

interface BoardAttitudeIndicatorProps {
  pitch: SharedValue<number | null>
  roll: SharedValue<number | null>
  connected?: boolean
  size?: number
  testID?: string
}

/** Live board orientation. Static Skia paths, matrix-only updates; no SVG or telemetry renders. */
export function BoardAttitudeIndicator({
  pitch,
  roll,
  connected = true,
  size = 48,
  testID,
}: BoardAttitudeIndicatorProps) {
  'use no memo'
  const color = useResolvedColor(connected ? theme.palette.purple.color : HUD_IDLE_GLYPH_COLOR)
  const paths = useMemo(() => buildPaths(), [])
  const scale = size / ATTITUDE_EXTENT
  const stroke = 1 / scale
  const pose = useDerivedValue(() => boardAttitudePose(connected ? roll.value : 0))
  const rotation = useDerivedValue(() => {
    const value = connected ? pitch.value : 0
    return [{ rotate: value != null && Number.isFinite(value) ? (value * Math.PI) / 180 : 0 }]
  })
  const farRail = useDerivedValue(() => pose.value.farRail)
  const nearRail = useDerivedValue(() => pose.value.nearRail)
  const nearTire = useDerivedValue(() => pose.value.nearTire)
  const farTire = useDerivedValue(() => pose.value.farTire)
  const farTireArc = useDerivedValue(() => pose.value.farTireArc)
  const tread = useDerivedValue(() => pose.value.tread)
  const top = useDerivedValue(() => pose.value.top)
  const bottom = useDerivedValue(() => pose.value.bottom)
  const leftCap = useDerivedValue(() => pose.value.leftCap)
  const rightCap = useDerivedValue(() => pose.value.rightCap)
  const edgeOnOpacity = useDerivedValue(() => pose.value.edgeOnOpacity)
  const topVisible = useDerivedValue(() => pose.value.topVisible)
  const bottomVisible = useDerivedValue(() => pose.value.bottomVisible)

  return (
    <Canvas style={{ width: size, height: size }} testID={testID}>
      {/* A tiny isolated layer allows opaque-looking wire outlines over the transparent map. */}
      <Group layer transform={[{ translateX: size / 2 }, { translateY: size / 2 }, { scale }]}>
        <Group transform={rotation}>
          <Group matrix={farRail}>
            <SolidOutline path={paths.rail} color={color} stroke={stroke} />
          </Group>
          {/* Cylinder silhouette = two ellipses and their connecting strip. Clear all first. */}
          <Group matrix={farTire}>
            <Path path={paths.tire} blendMode="dstOut" />
          </Group>
          <Group matrix={nearTire}>
            <Path path={paths.tire} blendMode="dstOut" />
          </Group>
          <Group matrix={tread}>
            <Path path={paths.tread} blendMode="dstOut" />
            <Path path={paths.treadSides} color={color} style="stroke" strokeWidth={stroke} />
          </Group>
          <Group matrix={farTireArc}>
            <Path path={paths.farArc} color={color} style="stroke" strokeWidth={stroke} />
          </Group>
          <Group matrix={nearTire}>
            <Path path={paths.tire} color={color} style="stroke" strokeWidth={stroke} />
          </Group>
          <Group opacity={topVisible} matrix={top}>
            <SolidOutline path={paths.top} color={color} stroke={stroke} />
          </Group>
          <Group opacity={bottomVisible}>
            <Group matrix={bottom}>
              <SolidOutline path={paths.bottom} color={color} stroke={stroke} />
            </Group>
            <Group matrix={leftCap}>
              <SolidOutline path={paths.cap} color={color} stroke={stroke} />
            </Group>
            <Group matrix={rightCap}>
              <SolidOutline path={paths.cap} color={color} stroke={stroke} />
            </Group>
          </Group>
          <Group matrix={nearRail}>
            <SolidOutline path={paths.rail} color={color} stroke={stroke} />
          </Group>
          <Group opacity={edgeOnOpacity} matrix={tread}>
            <Path path={paths.edgeOn} color={color} style="stroke" strokeWidth={stroke} />
          </Group>
        </Group>
      </Group>
    </Canvas>
  )
}
