import { useMemo } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Canvas, Circle, Path } from '@shopify/react-native-skia'
import { Image } from 'expo-image'

import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedColor } from '@/hooks/useTheme'
import { useRoutePreviewTiles } from '@/modules/history/hooks/useRoutePreviewTiles'
import {
  routePreviewPath,
  routePreviewProjection,
  type RoutePoint,
} from '@/modules/history/lib/routePreview'

interface RouteSparklineProps {
  points: RoutePoint[]
  width: number
  height: number
  /** Line color; the ride list tints a selected row and Favorites use their own amber. */
  color?: ThemeColor
  /** Green start and red end dots. Off on small thumbnails where they only add noise. */
  endpoints?: boolean
  /** Dark street map behind the route once its tiles are on disk; the plain route until then. */
  map?: boolean
  style?: StyleProp<ViewStyle>
}

/**
 * A ride's route drawn as a thumbnail. One component so a route reads the same everywhere it is
 * previewed — the ride list, the History drawer, a Favorite card. Route and map share one Web
 * Mercator frame, so the line sits on the streets it was ridden on.
 */
export function RouteSparkline({
  points,
  width,
  height,
  color = theme.palette.purple.color,
  endpoints = false,
  map = true,
  style,
}: RouteSparklineProps) {
  const tiles = useRoutePreviewTiles(points, width, height, map)
  const resolvedColor = useResolvedColor(color)
  const startColor = useResolvedColor(theme.palette.green.color)
  const endColor = useResolvedColor(theme.status.error.color)
  const path = useMemo(() => routePreviewPath(points, width, height), [height, points, width])
  const marks = useMemo(() => {
    if (!endpoints || points.length < 2) return null
    const project = routePreviewProjection(points, width, height)
    return { start: project(points[0]), end: project(points[points.length - 1]) }
  }, [endpoints, height, points, width])

  return (
    <View style={[styles.container, tiles && styles.mapped, { width, height }, style]}>
      {tiles?.map((tile) => (
        <Image
          key={`${tile.z}/${tile.x}/${tile.y}/${tile.left}`}
          source={{ uri: tile.uri }}
          style={[
            styles.tile,
            { left: tile.left, top: tile.top, width: tile.size, height: tile.size },
          ]}
        />
      ))}
      {path ? (
        <Canvas style={{ width, height }}>
          <Path
            path={path}
            style="stroke"
            color={resolvedColor}
            strokeWidth={2}
            strokeCap="round"
            strokeJoin="round"
          />
          {marks ? (
            <>
              <Circle cx={marks.start.x} cy={marks.start.y} r={3} color={startColor} />
              <Circle cx={marks.end.x} cy={marks.end.y} r={3} color={endColor} />
            </>
          ) : null}
        </Canvas>
      ) : (
        <View style={styles.emptyLine} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapped: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  tile: {
    position: 'absolute',
  },
  emptyLine: {
    width: 28,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.palette.slate.border,
  },
})
