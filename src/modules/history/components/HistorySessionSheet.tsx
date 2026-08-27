import { useCallback, useMemo, useRef, type RefObject } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { ClockCounterClockwiseIcon, StarIcon } from 'phosphor-react-native'
import type { Favorite } from 'vescape-core'

import { Placeholder } from '@/components/base/Placeholder'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { interaction, theme } from '@/constants/theme'
import { HistoryRideRow } from '@/modules/history/components/HistoryRideRow'
import { favoriteSessionId } from '@/modules/history/lib/favorites'
import {
  formatFavoriteName,
  formatRideListDateTime,
  formatRideListDetails,
} from '@/modules/history/lib/rideFormat'
import { isLiveRide, rideMovingWindow } from '@/modules/history/lib/sessions'
import { useHistoryAutoRefresh } from '@/modules/history/hooks/useHistoryAutoRefresh'
import type { HistorySession } from '@/modules/history/store/historyStore'

interface HistorySessionSheetProps {
  visible: boolean
  triggerRef: RefObject<View | null>
  favoriteMode: boolean
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
  useHistoryAutoRefresh(visible && !favoriteMode)
  const favoritesBySessionId = useMemo(
    () => new Map(favorites.map((favorite) => [favoriteSessionId(favorite.id), favorite])),
    [favorites],
  )

  const renderSession = useCallback(
    ({ item }: { item: unknown }) => {
      const session = item as HistorySession
      const selected = session.id === selectedSessionId
      const favorite = favoritesBySessionId.get(session.id)
      const rideWindow = rideMovingWindow(session) ?? {
        startMs: session.startAtMs,
        endMs: session.endAtMs,
      }
      const dateTime = formatRideListDateTime(
        rideWindow.startMs,
        rideWindow.endMs,
        !favorite && isLiveRide(session, Date.now()),
      )
      const details = formatRideListDetails(
        rideWindow.endMs - rideWindow.startMs,
        session.distanceM,
        favorite?.boardName ?? session.deviceName,
      )
      return (
        <HistoryRideRow
          ref={selected ? selectedRowRef : undefined}
          testID={`history-session-row-${session.id}`}
          title={
            favorite
              ? formatFavoriteName(favorite.name, favorite.startMs, favorite.endMs)
              : dateTime
          }
          subtitle={favorite ? dateTime : details}
          details={favorite ? details : undefined}
          routePoints={session.routePoints}
          selected={selected}
          onPress={() => onSelectSession(session)}
        />
      )
    },
    [favoritesBySessionId, onSelectSession, selectedSessionId],
  )

  const empty = (
    <Placeholder
      icon={favoriteMode ? StarIcon : ClockCounterClockwiseIcon}
      title={favoriteMode ? 'No favorites yet' : 'No rides yet'}
      description={
        favoriteMode
          ? 'Open a ride in History, tap the star, adjust the range, then save'
          : 'Record a ride and it shows up in this list'
      }
      style={styles.empty}
    />
  )

  const footer = hasMore ? (
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
  ) : null

  return (
    <EdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      title={favoriteMode ? 'Favorites' : 'History'}
      icon={favoriteMode ? StarIcon : ClockCounterClockwiseIcon}
      iconColor={favoriteMode ? theme.palette.amber.color : theme.palette.purple.color}
      onClose={onClose}
      initialFocusRef={selectedRowRef}
      backdropTestID="history-session-sheet-backdrop"
      virtualizedContent={{
        data: sessions,
        renderItem: renderSession,
        keyExtractor: (item) => (item as HistorySession).id,
        empty,
        footer,
        separator: HistoryRowSeparator,
        onEndReached: hasMore && !loadingMore ? onLoadMore : undefined,
        onEndReachedThreshold: 0.75,
        testID: 'history-session-sheet',
      }}
    />
  )
}

function HistoryRowSeparator() {
  return <View style={styles.separator} />
}

const styles = StyleSheet.create({
  separator: { height: 8 },
  empty: {
    paddingVertical: 28,
  },
  loadingRow: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  loadingPressed: {
    backgroundColor: interaction.pressedBg,
  },
  loadingText: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
})
