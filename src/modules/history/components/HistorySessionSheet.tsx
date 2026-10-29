import { useRideFormat } from '@/modules/history/hooks/useRideFormat'
import { useCallback, useMemo, type RefObject } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text } from '@/components/base/Text'
import { ClockCounterClockwiseIcon, StarIcon } from 'phosphor-react-native'
import type { Favorite } from 'vescape-core'

import { Placeholder } from '@/components/base/Placeholder'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { theme } from '@/constants/theme'
import { HistoryTabs } from '@/modules/history/components/HistoryTabs'
import { HistoryRideRow, HistoryRideRowSkeleton } from '@/modules/history/components/HistoryRideRow'
import {
  historyListRows,
  historyListLayouts,
  HISTORY_RIDE_ROW_HEIGHT,
  HISTORY_RIDE_ROW_GAP,
} from '@/modules/history/lib/historyList'
import { favoriteSessionId } from '@/modules/history/lib/favorites'
import { formatFavoriteName, formatRideTime } from '@/modules/history/lib/rideFormat'
import { isLiveRide } from '@/modules/history/lib/sessions'
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
  onSelectTab: (tab: 'history' | 'favorites') => void
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
  onSelectTab,
}: HistorySessionSheetProps) {
  const { formatRideDetails } = useRideFormat()
  const { fontScale } = useWindowDimensions()
  const dateHeaderHeight = 22 + 16 * fontScale
  useHistoryAutoRefresh(visible && !favoriteMode)
  const favoritesBySessionId = useMemo(
    () => new Map(favorites.map((favorite) => [favoriteSessionId(favorite.id), favorite])),
    [favorites],
  )

  const rows = useMemo(() => historyListRows(sessions), [sessions])
  const layouts = useMemo(
    () => historyListLayouts(rows, dateHeaderHeight),
    [rows, dateHeaderHeight],
  )
  const selectedIndex = sessions.findIndex((session) => session.id === selectedSessionId)
  const selectedLayout = layouts[selectedIndex]

  const renderSession = useCallback(
    ({ item }: { item: unknown }) => {
      const { session, window: rideWindow, dateHeader } = item as (typeof rows)[number]
      const selected = session.id === selectedSessionId
      const favorite = favoritesBySessionId.get(session.id)
      const time = formatRideTime(
        rideWindow.startMs,
        rideWindow.endMs,
        !favorite && isLiveRide(session, Date.now()),
      )
      const details = formatRideDetails(
        rideWindow.endMs - rideWindow.startMs,
        session.distanceM,
        favorite?.boardName ?? session.boardName,
      )
      return (
        <View>
          {dateHeader ? (
            <Text
              accessibilityRole="header"
              style={[styles.dateHeader, { height: dateHeaderHeight }]}
            >
              {dateHeader}
            </Text>
          ) : null}
          <HistoryRideRow
            testID={`history-session-row-${session.id}`}
            title={
              favorite ? formatFavoriteName(favorite.name, favorite.startMs, favorite.endMs) : time
            }
            subtitle={favorite ? time : details}
            details={favorite ? details : undefined}
            routePoints={session.routePoints}
            selected={selected}
            accent={favorite ? theme.palette.amber.color : undefined}
            weather={session.weather}
            onPress={() => onSelectSession(session)}
          />
        </View>
      )
    },
    [favoritesBySessionId, onSelectSession, selectedSessionId, formatRideDetails, dateHeaderHeight],
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

  const footer =
    hasMore && loadingMore ? (
      <View
        style={styles.loadingRows}
        accessibilityLabel="Loading older rides"
        accessibilityRole="progressbar"
        accessibilityState={{ busy: true }}
        testID="history-loading-older-rides"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <HistoryRideRowSkeleton key={index} />
        ))}
      </View>
    ) : null

  return (
    <EdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      header={
        <HistoryTabs tab={favoriteMode ? 'favorites' : 'history'} onSelectTab={onSelectTab} />
      }
      contentPageKey={favoriteMode ? 'favorites' : 'history'}
      onClose={onClose}
      backdropTestID="history-session-sheet-backdrop"
      virtualizedContent={{
        data: rows,
        initialFocus: selectedLayout
          ? { offset: selectedLayout.rowOffset, height: HISTORY_RIDE_ROW_HEIGHT }
          : undefined,
        getItemLayout: (_data, index) => layouts[index],
        renderItem: renderSession,
        keyExtractor: (item) => (item as (typeof rows)[number]).session.id,
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
  separator: { height: HISTORY_RIDE_ROW_GAP },
  dateHeader: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
    fontWeight: '700',
    paddingTop: 12,
    paddingBottom: 10,
  },
  empty: {
    paddingVertical: 28,
  },
  loadingRows: {
    gap: 8,
    paddingTop: 8,
  },
})
