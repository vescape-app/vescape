import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import { router } from 'expo-router'
import {
  CaretRightIcon,
  ClockCounterClockwiseIcon,
  StarIcon,
  WarningCircleIcon,
} from 'phosphor-react-native'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { SectionHeader } from '@/components/base/SectionHeader'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { theme } from '@/constants/theme'
import { FavoriteRideCard } from '@/modules/history/components/FavoriteRideCard'
import { HistoryRideRow } from '@/modules/history/components/HistoryRideRow'
import { HistorySessionSheet } from '@/modules/history/components/HistorySessionSheet'
import { favoriteSessionId, favoriteToSession } from '@/modules/history/lib/favorites'
import { formatRideListDateTime, formatRideListDetails } from '@/modules/history/lib/rideFormat'
import { isLiveRide, rideMovingWindow, type HistorySession } from '@/modules/history/lib/sessions'
import { useHistoryAutoRefresh } from '@/modules/history/hooks/useHistoryAutoRefresh'
import { useFavoriteStore, type Favorite } from '@/modules/history/store/favoriteStore'
import { useHistoryStore } from '@/modules/history/store/historyStore'
import { ProfileStatsSummary } from '@/modules/profile/components/ProfileStatsSummary'
import { routes } from '@/navigation/routes'

type ListMode = 'rides' | 'favorites' | null

interface HistoryDrawerProps {
  visible: boolean
  triggerRef: RefObject<View | null>
  onClose: () => void
  onOpenRide: (session: HistorySession) => void
  onOpenFavorite: (favoriteId: string, session: HistorySession) => void
}

/** Riding overview opened from the main History button. */
export function HistoryDrawer({
  visible,
  triggerRef,
  onClose,
  onOpenRide,
  onOpenFavorite,
}: HistoryDrawerProps) {
  const [listMode, setListMode] = useState<ListMode>(null)
  const [ridesLoaded, setRidesLoaded] = useState(false)
  const [favoritesLoaded, setFavoritesLoaded] = useState(false)
  const blocks = useHistoryStore((state) => state.blocks)
  const sessions = useHistoryStore((state) => state.sessions)
  const historyLoading = useHistoryStore((state) => state.loading)
  const historyError = useHistoryStore((state) => state.error)
  const hasMore = useHistoryStore((state) => state.hasMore)
  const favorites = useFavoriteStore((state) => state.favorites)
  const favoritesLoading = useFavoriteStore((state) => state.loading)
  const favoritesError = useFavoriteStore((state) => state.error)
  const loadFavorites = useFavoriteStore((state) => state.load)

  useHistoryAutoRefresh(visible)

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setRidesLoaded(false)
    setFavoritesLoaded(false)
    void useHistoryStore
      .getState()
      .loadInitial()
      .then(() => {
        if (!cancelled) setRidesLoaded(true)
      })
    void loadFavorites().then(() => {
      if (!cancelled) setFavoritesLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [loadFavorites, visible])

  const favoriteSessions = useMemo(
    () => favorites.map((favorite) => favoriteToSession(favorite, blocks)),
    [blocks, favorites],
  )

  const openRide = useCallback(
    (session: HistorySession) => {
      setListMode(null)
      onClose()
      onOpenRide(session)
    },
    [onClose, onOpenRide],
  )

  const openFavorite = useCallback(
    (favorite: Favorite) => {
      setListMode(null)
      onClose()
      onOpenFavorite(favorite.id, favoriteToSession(favorite, blocks))
    },
    [blocks, onClose, onOpenFavorite],
  )

  const showList = useCallback(
    (mode: Exclude<ListMode, null>) => {
      setListMode(mode)
      onClose()
    },
    [onClose],
  )

  const openStats = useCallback(() => {
    onClose()
    router.push(routes.profileStats)
  }, [onClose])

  return (
    <>
      <EdgeDrawer
        visible={visible}
        triggerRef={triggerRef}
        title="History"
        icon={ClockCounterClockwiseIcon}
        iconColor={theme.palette.purple.color}
        onClose={onClose}
        backdropTestID="history-drawer-backdrop"
      >
        <View style={styles.content} testID="history-drawer">
          <ProfileStatsSummary
            active={visible}
            action={
              <Button
                label="Details"
                testID="history-stats-details"
                icon={CaretRightIcon}
                iconPosition="right"
                size="sm"
                variant="secondary"
                onPress={openStats}
              />
            }
          />

          <SectionHeader
            icon={ClockCounterClockwiseIcon}
            color={theme.palette.purple.color}
            title="Last rides"
            right={
              <Button
                label="All rides"
                icon={CaretRightIcon}
                iconPosition="right"
                size="sm"
                variant="secondary"
                disabled={!ridesLoaded || historyLoading || sessions.length === 0}
                onPress={() => showList('rides')}
              />
            }
          />
          {!ridesLoaded || historyLoading ? (
            <RideListSkeleton />
          ) : sessions.length === 0 && historyError ? (
            <Placeholder
              icon={WarningCircleIcon}
              title="Could not load rides"
              description="Try loading ride history again"
              action={
                <Button
                  label="Retry"
                  size="sm"
                  variant="secondary"
                  onPress={() => useHistoryStore.getState().loadInitial()}
                />
              }
              style={styles.placeholder}
            />
          ) : sessions.length === 0 ? (
            <Placeholder
              icon={ClockCounterClockwiseIcon}
              title="No rides yet"
              description="Record a ride and it shows up here"
              style={styles.placeholder}
            />
          ) : (
            <View style={styles.rideList}>
              {sessions.slice(0, 3).map((session, index) => {
                const window = rideMovingWindow(session) ?? {
                  startMs: session.startAtMs,
                  endMs: session.endAtMs,
                }
                const details = [
                  formatRideListDetails(window.endMs - window.startMs, session.distanceM, null),
                  `${Math.round(session.maxSpeedKmh)} km/h`,
                ].join(' · ')
                return (
                  <HistoryRideRow
                    key={session.id}
                    testID={index === 0 ? 'history-latest-ride' : undefined}
                    title={formatRideListDateTime(
                      window.startMs,
                      window.endMs,
                      isLiveRide(session, Date.now()),
                    )}
                    subtitle={details}
                    routePoints={session.routePoints}
                    onPress={() => openRide(session)}
                  />
                )
              })}
            </View>
          )}

          <SectionHeader
            icon={StarIcon}
            color={theme.palette.amber.color}
            title={`Favorites${favorites.length ? ` · ${favorites.length}` : ''}`}
            right={
              <Button
                label="See all"
                icon={CaretRightIcon}
                iconPosition="right"
                size="sm"
                variant="secondary"
                disabled={!favoritesLoaded || favoritesLoading || favorites.length === 0}
                onPress={() => showList('favorites')}
              />
            }
          />
          {favorites.length === 0 && (!favoritesLoaded || favoritesLoading) ? (
            <ActivityIndicator
              size="small"
              color={theme.palette.amber.color}
              style={styles.loading}
            />
          ) : favorites.length === 0 && favoritesError ? (
            <Placeholder
              icon={WarningCircleIcon}
              title="Could not load favorites"
              description="Try loading favorites again"
              action={
                <Button label="Retry" size="sm" variant="secondary" onPress={loadFavorites} />
              }
              style={styles.placeholder}
            />
          ) : favorites.length === 0 ? (
            <Placeholder
              icon={StarIcon}
              title="No favorites yet"
              description="Open a ride in History, tap the star, adjust the range, then save"
              style={styles.placeholder}
            />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.favoriteList}
            >
              {favorites.slice(0, 8).map((favorite, index) => (
                <FavoriteRideCard
                  key={favorite.id}
                  favorite={favorite}
                  routePoints={favoriteSessions[index]?.routePoints ?? []}
                  onPress={() => openFavorite(favorite)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </EdgeDrawer>

      <HistorySessionSheet
        visible={listMode !== null}
        triggerRef={triggerRef}
        favoriteMode={listMode === 'favorites'}
        sessions={listMode === 'favorites' ? favoriteSessions : sessions}
        favorites={favorites}
        selectedSessionId={null}
        hasMore={listMode === 'rides' && hasMore}
        loadingMore={historyLoading}
        onClose={() => setListMode(null)}
        onSelectSession={(session) => {
          const favorite = favorites.find((item) => favoriteSessionId(item.id) === session.id)
          if (favorite) openFavorite(favorite)
          else openRide(session)
        }}
        onLoadMore={() => void useHistoryStore.getState().loadMore()}
      />
    </>
  )
}

function RideListSkeleton() {
  return (
    <View style={styles.rideList} accessibilityLabel="Loading recent rides">
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.rideSkeleton} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    padding: 12,
    gap: 12,
  },
  rideList: {
    gap: 8,
  },
  rideSkeleton: {
    height: 74,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
    opacity: 0.55,
  },
  favoriteList: {
    gap: 10,
    paddingRight: 12,
  },
  placeholder: {
    minHeight: 170,
    paddingVertical: 24,
  },
  loading: {
    marginVertical: 70,
  },
})
