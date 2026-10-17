import { useMemo } from 'react'
import { Canvas, Group, Path, Skia, type SkPath } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { personalizationColorOptions, theme } from '@/constants/theme'
import { useResolvedColor } from '@/hooks/useTheme'
import { HUD_IDLE_GLYPH_COLOR } from '@/modules/board/constants/telemetry'
import {
  ATTITUDE_EXTENT,
  boardAttitudePose,
  curvedDeckMatrix,
  endOnTirePose,
  RAIL_THICKNESS,
  TIRE_HALF_WIDTH,
  TIRE_RADIUS,
} from '@/modules/board/lib/boardAttitudeGeometry'
import { railDeckProfile, railPreset, railSideFace } from '@/modules/board/lib/railPresets'
import type { RailPoint } from '@/modules/board/lib/railProfile'

function polygon(points: readonly (readonly number[])[]): SkPath {
  const path = Skia.Path.Make()
  path.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) path.lineTo(points[i][0], points[i][1])
  path.close()
  return path
}

function deckSegments(
  railId?: string,
  railPoints?: readonly RailPoint[],
  thickness = RAIL_THICKNESS,
  pointThicknesses?: readonly number[],
  inset = 0,
) {
  const outerProfile = railDeckProfile(railId, railPoints, thickness, pointThicknesses)
  const leftX = outerProfile[0]![0]
  const rightX = outerProfile[outerProfile.length - 1]![0]
  const endInset = Math.min(inset, (rightX - leftX) / 2)
  const profile = inset
    ? outerProfile.map(([x, height], index) => [
        index === 0 ? x + endInset : index === outerProfile.length - 1 ? x - endInset : x,
        height + (pointThicknesses?.[index] ?? thickness) / 2,
      ])
    : outerProfile.map(([x, height], index) => [
        x,
        height - (pointThicknesses?.[index] ?? thickness) / 2,
      ])
  const heightAt = (x: number) => {
    for (let i = 1; i < profile.length; i++) {
      const [x0, h0] = profile[i - 1]!
      const [x1, h1] = profile[i]!
      if (x <= x1) return h0 + ((h1 - h0) * (x - x0)) / (x1 - x0)
    }
    return profile[profile.length - 1]![1]
  }
  const segments = [] as { path: SkPath; x0: number; x1: number; h0: number; h1: number }[]
  for (const [start, end] of [
    [leftX + endInset, Math.min(-89, rightX - endInset)],
    [Math.max(89, leftX + endInset), rightX - endInset],
  ]) {
    if (start >= end) continue
    const cuts = [start, ...profile.map(([x]) => x).filter((x) => x > start && x < end), end]
    for (let i = 1; i < cuts.length; i++) {
      const x0 = cuts[i - 1]!
      const x1 = cuts[i]!
      segments.push({
        path: polygon([
          [x0, -64],
          [x1, -64],
          [x1, 64],
          [x0, 64],
        ]),
        x0,
        x1,
        h0: heightAt(x0),
        h1: heightAt(x1),
      })
    }
  }
  return segments
}

function buildPaths(
  railId?: string,
  railPoints?: readonly RailPoint[],
  thickness = RAIL_THICKNESS,
  pointThicknesses?: readonly number[],
) {
  const railFace = railSideFace(railId, railPoints, thickness, pointThicknesses)
  const half = railFace.length / 2
  const leftX = railFace[0]![0]
  const rightX = railFace[half - 1]![0]
  const bevel = railFace[railFace.length - 1]![0] - leftX
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
  for (const [start, end, halfWidth] of [
    [leftX, rightX, 64],
    [-78, 78, 43],
  ]) {
    for (const y of [-halfWidth, halfWidth]) {
      edgeOn.moveTo(start, y)
      edgeOn.lineTo(end, y)
    }
  }
  return {
    edgeOn,
    rail: polygon(railFace),
    top: deckSegments(railId, railPoints, thickness, pointThicknesses),
    bottom: deckSegments(railId, railPoints, thickness, pointThicknesses, 21),
    cap: polygon([
      [0, -64],
      [bevel, -64],
      [bevel, 64],
      [0, 64],
    ]),
    tire,
    endOnTire: polygon([
      [-TIRE_HALF_WIDTH, -TIRE_RADIUS],
      [TIRE_HALF_WIDTH, -TIRE_RADIUS],
      [TIRE_HALF_WIDTH, TIRE_RADIUS],
      [-TIRE_HALF_WIDTH, TIRE_RADIUS],
    ]),
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

function CurvedDeckFace({
  segment,
  roll,
  yaw,
  color,
  fill,
  stroke,
}: {
  segment: ReturnType<typeof deckSegments>[number]
  roll: SharedValue<number | null>
  yaw?: SharedValue<number | null>
  color: string
  fill: string
  stroke: number
}) {
  const matrix = useDerivedValue(() =>
    curvedDeckMatrix(
      roll.value,
      segment.x0,
      segment.x1,
      segment.h0,
      segment.h1,
      0,
      yaw?.value ?? 0,
    ),
  )
  return (
    <Group matrix={matrix}>
      <SolidFace path={segment.path} color={color} fill={fill} stroke={stroke} />
    </Group>
  )
}

/** Neutral faces give the rail profile visible volume without a large accent fill. */
function SolidFace({
  path,
  color,
  fill,
  stroke,
}: {
  path: SkPath
  color: string
  fill: string
  stroke: number
}) {
  return (
    <>
      <Path path={path} color={fill} />
      <Path path={path} color={color} style="stroke" strokeWidth={stroke} strokeJoin="round" />
    </>
  )
}

interface BoardAttitudeIndicatorProps {
  pitch: SharedValue<number | null>
  roll: SharedValue<number | null>
  yaw?: SharedValue<number | null>
  connected?: boolean
  muted?: boolean
  railId?: string
  railPoints?: readonly RailPoint[]
  railThickness?: number
  railPointThicknesses?: readonly number[]
  railColorId?: string
  size?: number
  testID?: string
}

/** Live board orientation. Static Skia paths, matrix-only updates; no SVG or telemetry renders. */
export function BoardAttitudeIndicator({
  pitch,
  roll,
  yaw,
  connected = true,
  muted = false,
  railId,
  railPoints,
  railThickness,
  railPointThicknesses,
  railColorId,
  size = 48,
  testID,
}: BoardAttitudeIndicatorProps) {
  'use no memo'
  const preset = railPreset(railId)
  const thickness = railThickness ?? (railPoints ? RAIL_THICKNESS : preset.thickness)
  const pointThicknesses =
    railPointThicknesses ?? (railPoints ? undefined : preset.pointThicknesses)
  const accent = personalizationColorOptions.find((option) => option.id === railColorId)?.value
  const color = useResolvedColor(
    connected && !muted ? (accent ?? theme.palette.purple.color) : HUD_IDLE_GLYPH_COLOR,
  )
  const fill = useResolvedColor(theme.neutral.surfaceDeep)
  const topFill = useResolvedColor(theme.neutral.surface)
  const paths = useMemo(
    () => buildPaths(railId, railPoints, thickness, pointThicknesses),
    [railId, railPoints, thickness, pointThicknesses],
  )
  const scale = size / ATTITUDE_EXTENT
  const stroke = 1 / scale
  const leftThickness = pointThicknesses?.[0] ?? thickness
  const rightThickness = pointThicknesses?.[pointThicknesses.length - 1] ?? thickness
  const railFace = useMemo(
    () => railSideFace(railId, railPoints, thickness, pointThicknesses),
    [railId, railPoints, thickness, pointThicknesses],
  )
  const leftCapX = railFace[railFace.length - 1]![0]
  const rightCapX = railFace[railFace.length / 2]![0]
  const capLength = leftCapX - railFace[0]![0]
  const pose = useDerivedValue(() =>
    boardAttitudePose(
      connected ? roll.value : 0,
      thickness,
      leftThickness,
      rightThickness,
      connected ? (yaw?.value ?? 0) : 0,
      leftCapX,
      rightCapX,
      capLength,
    ),
  )
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
  const profile = useMemo(
    () => railDeckProfile(railId, railPoints, thickness, pointThicknesses),
    [railId, railPoints, thickness, pointThicknesses],
  )
  const leftHeight = profile[0]![1]
  const rightHeight = profile[profile.length - 1]![1]
  const leftCap = useDerivedValue(() => {
    const matrix = pose.value.leftCap.slice() as ReturnType<typeof boardAttitudePose>['leftCap']
    matrix[5] += leftHeight * Math.cos(((roll.value ?? 0) * Math.PI) / 180)
    return matrix
  })
  const rightCap = useDerivedValue(() => {
    const matrix = pose.value.rightCap.slice() as ReturnType<typeof boardAttitudePose>['rightCap']
    matrix[5] += rightHeight * Math.cos(((roll.value ?? 0) * Math.PI) / 180)
    return matrix
  })
  const edgeOnOpacity = useDerivedValue(() => pose.value.edgeOnOpacity)
  const topVisible = useDerivedValue(() => pose.value.topVisible)
  const bottomVisible = useDerivedValue(() => pose.value.bottomVisible)
  const endTire = useDerivedValue(() => endOnTirePose(roll.value, yaw?.value ?? 0))
  const endTireMatrix = useDerivedValue(() => endTire.value.matrix)
  const endTireOpacity = useDerivedValue(() => endTire.value.opacity)
  const rightFrontOpacity = useDerivedValue(() =>
    Math.max(0, Math.sin(((yaw?.value ?? 0) * Math.PI) / 180)),
  )
  const leftFrontOpacity = useDerivedValue(() =>
    Math.max(0, -Math.sin(((yaw?.value ?? 0) * Math.PI) / 180)),
  )

  return (
    <Canvas style={{ width: size, height: size }} testID={testID}>
      {/* A tiny isolated layer allows opaque-looking wire outlines over the transparent map. */}
      <Group layer transform={[{ translateX: size / 2 }, { translateY: size / 2 }, { scale }]}>
        <Group transform={rotation}>
          <Group matrix={farRail}>
            <SolidFace path={paths.rail} color={color} fill={fill} stroke={stroke} />
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
            <Path path={paths.tire} color={fill} />
            <Path path={paths.tire} color={color} style="stroke" strokeWidth={stroke} />
          </Group>
          <Group opacity={topVisible}>
            {paths.top.map((segment, index) => (
              <CurvedDeckFace
                key={index}
                segment={segment}
                roll={roll}
                yaw={yaw}
                color={color}
                fill={topFill}
                stroke={stroke}
              />
            ))}
          </Group>
          <Group opacity={bottomVisible}>
            {paths.bottom.map((segment, index) => (
              <CurvedDeckFace
                key={index}
                segment={segment}
                roll={roll}
                yaw={yaw}
                color={color}
                fill={fill}
                stroke={stroke}
              />
            ))}
            <Group matrix={leftCap}>
              <SolidFace path={paths.cap} color={color} fill={fill} stroke={stroke} />
            </Group>
            <Group matrix={rightCap}>
              <SolidFace path={paths.cap} color={color} fill={fill} stroke={stroke} />
            </Group>
          </Group>
          <Group matrix={nearRail}>
            <SolidFace path={paths.rail} color={color} fill={fill} stroke={stroke} />
          </Group>
          <Group opacity={leftFrontOpacity} matrix={leftCap}>
            <SolidFace path={paths.cap} color={color} fill={fill} stroke={stroke} />
          </Group>
          <Group opacity={rightFrontOpacity} matrix={rightCap}>
            <SolidFace path={paths.cap} color={color} fill={fill} stroke={stroke} />
          </Group>
          <Group opacity={endTireOpacity} matrix={endTireMatrix}>
            <SolidFace path={paths.endOnTire} color={color} fill={fill} stroke={stroke} />
          </Group>
          <Group opacity={edgeOnOpacity} matrix={tread}>
            <Path path={paths.edgeOn} color={color} style="stroke" strokeWidth={stroke} />
          </Group>
        </Group>
      </Group>
    </Canvas>
  )
}
