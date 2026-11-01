import { useRideFormat } from '@/modules/history/hooks/useRideFormat'
import { useCallback, useMemo, useState, type RefObject } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  CaretRightIcon,
  ClockCounterClockwiseIcon,
  FunnelSimpleIcon,
  StarIcon,
  XIcon,
} from 'phosphor-react-native'
import { countRideHistory, type Favorite, type RideDay, type RideHistoryFilter } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Placeholder } from '@/components/base/Placeholder'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { theme } from '@/constants/theme'
import { HistoryFilterPanel } from '@/modules/history/components/HistoryFilterPanel'
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
import { rideDayOf } from '@/modules/history/lib/rideDay'
import {
  EMPTY_RIDE_FILTER,
  isRideFilterActive,
  matchesRideFilter,
  toRideHistoryFilter,
} from '@/modules/history/lib/rideFilter'
import { useHistoryFilterStore } from '@/modules/history/store/historyFilterStore'
import { useHistoryStore } from '@/modules/history/store/historyStore'
import { useHistoryAutoRefresh } from '@/modules/history/hooks/useHistoryAutoRefresh'
import type { HistorySession } from '@/modules/history/store/historyStore'

const RIDE_NOUN = { one: 'ride', other: 'rides' }
const FAVORITE_NOUN = { one: 'favorite', other: 'favorites' }

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
  /** Adds Details to each day heading, opening that day's stats and rides. */
  onOpenDay?: (day: RideDay) => void
}

export function HistorySessionSheet({
  visible,
  triggerRef,
  favoriteMode,
  sessions: listedSessions,
  favorites,
  selectedSessionId,
  hasMore,
  loadingMore,
  onClose,
  onSelectSession,
  onLoadMore,
  onSelectTab,
  onOpenDay,
}: HistorySessionSheetProps) {
  const { formatRideDetails } = useRideFormat()
  const { fontScale } = useWindowDimensions()
  const dateHeaderHeight = 24 + 38 * fontScale
  useHistoryAutoRefresh(visible && !favoriteMode)
  const [filterOpen, setFilterOpen] = useState(false)
  const filterSelection = useHistoryFilterStore((state) => state.selection)
  const filtered = isRideFilterActive(filterSelection)
  const applyFilter = useCallback((selection: typeof filterSelection) => {
    setFilterOpen(false)
    useHistoryStore.getState().setRideFilter(selection)
  }, [])
  const countMatches = useCallback(
    async (filter: RideHistoryFilter) =>
      favoriteMode
        ? listedSessions.filter((session) => matchesRideFilter(session, filter)).length
        : countRideHistory(filter),
    [favoriteMode, listedSessions],
  )
  // Native filters the ride pages; favorites are all loaded, so they filter here by their ride.
  const sessions = useMemo(() => {
    if (!favoriteMode || !filtered) return listedSessions
    const filter = toRideHistoryFilter(filterSelection)
    return listedSessions.filter((session) => matchesRideFilter(session, filter))
  }, [favoriteMode, filterSelection, filtered, listedSessions])
  const favoritesBySessionId = useMemo(
    () => new Map(favorites.map((favorite) => [favoriteSessionId(favorite.id), favorite])),
    [favorites],
  )

  const openDay = favoriteMode ? undefined : onOpenDay
  const rows = useMemo(() => historyListRows(sessions), [sessions])
  const layouts = useMemo(
    () => historyListLayouts(rows, dateHeaderHeight),
    [rows, dateHeaderHeight],
  )
  const selectedIndex = sessions.findIndex((session) => session.id === selectedSessionId)
  const selectedLayout = layouts[selectedIndex]

  const renderSession = useCallback(
    ({ item }: { item: unknown }) => {
      const { session, window: rideWindow, dateHeader, day } = item as (typeof rows)[number]
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
          {dateHeader && day ? (
            <View style={[styles.dateHeaderRow, { height: dateHeaderHeight }]}>
              <View style={styles.dateHeaderText}>
                <Text accessibilityRole="header" style={styles.dateHeader}>
                  {dateHeader}
                </Text>
                <Text style={styles.dateHeaderDetails} numberOfLines={1}>
                  {`${day.rides} ${day.rides === 1 ? 'ride' : 'rides'} · ${formatRideDetails(day.durationMs, day.distanceM, null)}`}
                </Text>
              </View>
              {openDay && day.rides > 1 ? (
                <Button
                  label="Summary"
                  icon={CaretRightIcon}
                  iconPosition="right"
                  size="sm"
                  variant="secondary"
                  accessibilityLabel={`${dateHeader} summary`}
                  testID={`history-day-summary-${session.id}`}
                  onPress={() => openDay(rideDayOf(rideWindow.startMs))}
                />
              ) : null}
            </View>
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
    [
      favoritesBySessionId,
      onSelectSession,
      selectedSessionId,
      formatRideDetails,
      dateHeaderHeight,
      openDay,
    ],
  )

  const empty = (
    <Placeholder
      icon={favoriteMode ? StarIcon : ClockCounterClockwiseIcon}
      title={
        filtered ? 'Nothing matches the filter' : favoriteMode ? 'No favorites yet' : 'No rides yet'
      }
      description={
        filtered
          ? 'Change or clear the filter to see more'
          : favoriteMode
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
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <IconButton
              icon={filterOpen ? XIcon : FunnelSimpleIcon}
              accessibilityLabel={filterOpen ? 'Close filter' : 'Filter rides'}
              dot={filtered && !filterOpen ? theme.palette.purple.color : undefined}
              testID="history-filter-button"
              onPress={() => setFilterOpen((open) => !open)}
            />
            <HistoryTabs
              tab={favoriteMode ? 'favorites' : 'history'}
              onSelectTab={(tab) => {
                setFilterOpen(false)
                onSelectTab(tab)
              }}
            />
          </View>
          {filtered && !filterOpen ? (
            <Button
              label="Filtered · Clear"
              icon={XIcon}
              size="sm"
              variant="secondary"
              testID="history-filter-clear-chip"
              onPress={() => applyFilter(EMPTY_RIDE_FILTER)}
            />
          ) : null}
        </View>
      }
      contentPageKey={filterOpen ? 'filter' : favoriteMode ? 'favorites' : 'history'}
      onClose={() => {
        setFilterOpen(false)
        onClose()
      }}
      backdropTestID="history-session-sheet-backdrop"
      virtualizedContent={
        filterOpen
          ? undefined
          : {
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
            }
      }
    >
      {filterOpen ? (
        <HistoryFilterPanel
          selection={filterSelection}
          countMatches={countMatches}
          noun={favoriteMode ? FAVORITE_NOUN : RIDE_NOUN}
          onApply={applyFilter}
        />
      ) : null}
    </EdgeDrawer>
  )
}

function HistoryRowSeparator() {
  return <View style={styles.separator} />
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  separator: { height: HISTORY_RIDE_ROW_GAP },
  dateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 14,
    paddingBottom: 10,
  },
  dateHeaderText: {
    flex: 1,
  },
  dateHeader: {
    color: theme.neutral.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    includeFontPadding: false,
    fontWeight: '700',
  },
  dateHeaderDetails: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
    fontWeight: '600',
  },
  empty: {
    paddingVertical: 28,
  },
  loadingRows: {
    gap: 8,
    paddingTop: 8,
  },
})
