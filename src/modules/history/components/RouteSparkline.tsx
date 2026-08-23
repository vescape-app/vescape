import { useMemo } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Canvas, Circle, Path } from '@shopify/react-native-skia'

import { theme } from '@/constants/theme'
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
  color?: string
  /** Green start and red end dots. Off on small thumbnails where they only add noise. */
  endpoints?: boolean
  style?: StyleProp<ViewStyle>
}

/**
 * A ride's route drawn as a thumbnail. One component so a route reads the same everywhere it is
 * previewed — the ride list, the History drawer, a Favorite card.
 */
export function RouteSparkline({
  points,
  width,
  height,
  color = theme.palette.purple.color,
  endpoints = false,
  style,
}: RouteSparklineProps) {
  const path = useMemo(() => routePreviewPath(points, width, height), [height, points, width])
  const marks = useMemo(() => {
    if (!endpoints || points.length < 2) return null
    const project = routePreviewProjection(points, width, height)
    return { start: project(points[0]), end: project(points[points.length - 1]) }
  }, [endpoints, height, points, width])

  return (
    <View style={[styles.container, { width, height }, style]}>
      {path ? (
        <Canvas style={{ width, height }}>
          <Path
            path={path}
            style="stroke"
            color={color}
            strokeWidth={2}
            strokeCap="round"
            strokeJoin="round"
          />
          {marks ? (
            <>
              <Circle
                cx={marks.start.x}
                cy={marks.start.y}
                r={3}
                color={theme.palette.green.color}
              />
              <Circle cx={marks.end.x} cy={marks.end.y} r={3} color={theme.status.error.color} />
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
  emptyLine: {
    width: 28,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.palette.slate.border,
  },
})
