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
  RAIL_THICKNESS,
  TIRE_HALF_WIDTH,
  TIRE_RADIUS,
} from '@/modules/board/lib/boardAttitudeGeometry'
import { railDeckProfile, railSideFace } from '@/modules/board/lib/railPresets'
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
  const profile = inset
    ? outerProfile.map(([x, height], index) => [
        index === 0 ? -218 + inset : index === outerProfile.length - 1 ? 218 - inset : x,
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
    [-218 + inset, -89],
    [89, 218 - inset],
  ]) {
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
    rail: polygon(railSideFace(railId, railPoints, thickness, pointThicknesses)),
    top: deckSegments(railId, railPoints, thickness, pointThicknesses),
    bottom: deckSegments(railId, railPoints, thickness, pointThicknesses, 21),
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

function CurvedDeckFace({
  segment,
  roll,
  color,
  fill,
  stroke,
}: {
  segment: ReturnType<typeof deckSegments>[number]
  roll: SharedValue<number | null>
  color: string
  fill: string
  stroke: number
}) {
  const matrix = useDerivedValue(() =>
    curvedDeckMatrix(roll.value, segment.x0, segment.x1, segment.h0, segment.h1, 0),
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
  connected = true,
  muted = false,
  railId,
  railPoints,
  railThickness = RAIL_THICKNESS,
  railPointThicknesses,
  railColorId,
  size = 48,
  testID,
}: BoardAttitudeIndicatorProps) {
  'use no memo'
  const accent = personalizationColorOptions.find((option) => option.id === railColorId)?.value
  const color = useResolvedColor(
    connected && !muted ? (accent ?? theme.palette.purple.color) : HUD_IDLE_GLYPH_COLOR,
  )
  const fill = useResolvedColor(theme.neutral.surfaceDeep)
  const topFill = useResolvedColor(theme.neutral.surface)
  const paths = useMemo(
    () => buildPaths(railId, railPoints, railThickness, railPointThicknesses),
    [railId, railPoints, railThickness, railPointThicknesses],
  )
  const scale = size / ATTITUDE_EXTENT
  const stroke = 1 / scale
  const leftThickness = railPointThicknesses?.[0] ?? railThickness
  const rightThickness = railPointThicknesses?.[railPointThicknesses.length - 1] ?? railThickness
  const pose = useDerivedValue(() =>
    boardAttitudePose(connected ? roll.value : 0, railThickness, leftThickness, rightThickness),
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
    () => railDeckProfile(railId, railPoints, railThickness, railPointThicknesses),
    [railId, railPoints, railThickness, railPointThicknesses],
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
          <Group opacity={edgeOnOpacity} matrix={tread}>
            <Path path={paths.edgeOn} color={color} style="stroke" strokeWidth={stroke} />
          </Group>
        </Group>
      </Group>
    </Canvas>
  )
}
