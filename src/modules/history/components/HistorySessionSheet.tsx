import { useMemo, useRef, type RefObject } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { CaretRightIcon, ClockCounterClockwiseIcon, StarIcon } from 'phosphor-react-native'
import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia'
import type { Favorite } from 'vescape-core'

import { EdgeDrawer } from '@/components/overlays/AnchoredSheet'
import { interaction, theme } from '@/constants/theme'
import { HistoryRideLabel } from '@/modules/history/components/HistoryRideLabel'
import { favoriteSessionId } from '@/modules/history/lib/favorites'
import {
  formatFavoriteName,
  formatRideListDateTime,
  formatRideListDetails,
} from '@/modules/history/lib/rideFormat'
import { rideMovingWindow } from '@/modules/history/lib/sessions'
import type { HistorySession, TelemetryMinuteBucket } from '@/modules/history/store/historyStore'

interface HistorySessionSheetProps {
  visible: boolean
  triggerRef: RefObject<View | null>
  favoriteMode: boolean
  blocks: TelemetryMinuteBucket[]
  sessions: HistorySession[]
  favorites: Favorite[]
  selectedSessionId: string | null
  hasMore: boolean
  loadingMore: boolean
  onClose: () => void
  onSelectSession: (session: HistorySession) => void
  onLoadMore: () => void
}

export function HistorySessionSheet({
  visible,
  triggerRef,
  favoriteMode,
  blocks,
  sessions,
  favorites,
  selectedSessionId,
  hasMore,
  loadingMore,
  onClose,
  onSelectSession,
  onLoadMore,
}: HistorySessionSheetProps) {
  const selectedRowRef = useRef<View>(null)
  const favoritesBySessionId = useMemo(
    () => new Map(favorites.map((favorite) => [favoriteSessionId(favorite.id), favorite])),
    [favorites],
  )

  return (
    <EdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      title={favoriteMode ? 'Favorites' : 'History'}
      icon={favoriteMode ? StarIcon : ClockCounterClockwiseIcon}
      iconColor={favoriteMode ? theme.palette.amber.color : theme.palette.purple.color}
      onClose={onClose}
      initialFocusRef={selectedRowRef}
      onReachContentEnd={hasMore && !loadingMore ? onLoadMore : undefined}
      backdropTestID="history-session-sheet-backdrop"
    >
      <View testID="history-session-sheet" style={styles.content}>
        {sessions.length === 0 ? (
          <Text style={styles.emptyText}>No sessions</Text>
        ) : (
          sessions.map((session) => {
            const selected = session.id === selectedSessionId
            const routePoints = getSessionRoutePreviewPoints(blocks, session)
            const favorite = favoritesBySessionId.get(session.id)
            const rideWindow = rideMovingWindow(session) ?? {
              startMs: session.startAtMs,
              endMs: session.endAtMs,
            }
            const dateTime = formatRideListDateTime(rideWindow.startMs, rideWindow.endMs)
            const details = formatRideListDetails(
              rideWindow.endMs - rideWindow.startMs,
              session.distanceM,
              favorite?.boardName ?? session.deviceName,
            )
            return (
              <Pressable
                ref={selected ? selectedRowRef : undefined}
                key={session.id}
                testID={`history-session-row-${session.id}`}
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.row,
                  selected && styles.rowSelected,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => onSelectSession(session)}
              >
                <RoutePreview points={routePoints} selected={selected} />
                <View style={styles.rowMain}>
                  <HistoryRideLabel
                    title={
                      favorite
                        ? formatFavoriteName(favorite.name, favorite.startMs, favorite.endMs)
                        : dateTime
                    }
                    subtitle={favorite ? dateTime : details}
                    details={favorite ? details : undefined}
                  />
                </View>
                <CaretRightIcon size={16} color={theme.palette.slate.textDim} weight="bold" />
              </Pressable>
            )
          })
        )}
        {hasMore && (
          <Pressable
            style={({ pressed }) => [styles.loadingRow, pressed && styles.loadingPressed]}
            disabled={loadingMore}
            onPress={onLoadMore}
          >
            {loadingMore ? (
              <ActivityIndicator size="small" color={theme.palette.sky.color} />
            ) : (
              <Text style={styles.loadingText}>Load older rides</Text>
            )}
          </Pressable>
        )}
      </View>
    </EdgeDrawer>
  )
}

interface RoutePoint {
  latitude: number
  longitude: number
}

function getSessionRoutePreviewPoints(
  blocks: TelemetryMinuteBucket[],
  session: HistorySession,
): RoutePoint[] {
  const blockIds = new Set(session.blockIds)
  return blocks
    .filter(
      (block) =>
        blockIds.has(block.id) && block.firstLatitude != null && block.firstLongitude != null,
    )
    .sort((a, b) => a.startAtMs - b.startAtMs)
    .map((block) => ({
      latitude: block.firstLatitude!,
      longitude: block.firstLongitude!,
    }))
}

function RoutePreview({ points, selected }: { points: RoutePoint[]; selected: boolean }) {
  const path = useMemo(() => buildPreviewPath(points), [points])
  const start = points.length > 0 ? formatPreviewPoint(points, 0) : null
  const end = points.length > 1 ? formatPreviewPoint(points, points.length - 1) : null
  const strokeColor = selected ? theme.palette.sky.color : theme.palette.purple.color

  return (
    <View style={styles.routePreview}>
      {path ? (
        <Canvas style={styles.routeCanvas}>
          <Path
            path={path}
            style="stroke"
            color={strokeColor}
            strokeWidth={2}
            strokeCap="round"
            strokeJoin="round"
          />
          {start && <Circle cx={start.x} cy={start.y} r={3} color={theme.palette.green.color} />}
          {end && <Circle cx={end.x} cy={end.y} r={3} color={theme.status.error.color} />}
        </Canvas>
      ) : (
        <View style={styles.routeEmpty}>
          <View style={styles.routeEmptyLine} />
        </View>
      )}
    </View>
  )
}

function buildPreviewPath(points: RoutePoint[]) {
  if (points.length < 2) return null
  const first = formatPreviewPoint(points, 0)
  const builder = Skia.PathBuilder.Make().moveTo(first.x, first.y)
  for (let index = 1; index < points.length; index += 1) {
    const { x, y } = formatPreviewPoint(points, index)
    builder.lineTo(x, y)
  }
  return builder.detach()
}

const PREVIEW_WIDTH = 74
const PREVIEW_HEIGHT = 52

function formatPreviewPoint(points: RoutePoint[], index: number): { x: number; y: number } {
  const width = PREVIEW_WIDTH
  const height = PREVIEW_HEIGHT
  const padding = 8
  const minLatitude = Math.min(...points.map((point) => point.latitude))
  const maxLatitude = Math.max(...points.map((point) => point.latitude))
  const minLongitude = Math.min(...points.map((point) => point.longitude))
  const maxLongitude = Math.max(...points.map((point) => point.longitude))
  const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.00001)
  const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.00001)
  const point = points[index]
  const x = padding + ((point.longitude - minLongitude) / longitudeSpan) * (width - padding * 2)
  const y = padding + ((maxLatitude - point.latitude) / latitudeSpan) * (height - padding * 2)
  return { x, y }
}

const styles = StyleSheet.create({
  content: {
    gap: 8,
  },
  emptyText: {
    color: theme.palette.slate.textSecondary,
    textAlign: 'center',
    paddingVertical: 20,
  },
  row: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowSelected: {
    borderColor: theme.palette.sky.color,
  },
  rowPressed: {
    backgroundColor: interaction.pressedBg,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  routePreview: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeCanvas: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
  },
  routeEmpty: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeEmptyLine: {
    width: 28,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.palette.slate.border,
  },
  loadingRow: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  loadingPressed: {
    backgroundColor: interaction.pressedBg,
  },
  loadingText: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
})
