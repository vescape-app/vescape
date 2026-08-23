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
import { sessionRoutePoints } from '@/modules/history/lib/routePreview'
import { rideMovingWindow, type HistorySession } from '@/modules/history/lib/sessions'
import { useFavoriteStore, type Favorite } from '@/modules/history/store/favoriteStore'
import { useHistoryStore } from '@/modules/history/store/historyStore'
import { ProfileStatsSummary } from '@/modules/profile/components/ProfileStatsSummary'
import { routes } from '@/navigation/routes'
import { useMainScreenStore } from '@/screens/main/mainScreenStore'

type ListMode = 'rides' | 'favorites' | null

interface HistoryDrawerProps {
  visible: boolean
  triggerRef: RefObject<View | null>
  onClose: () => void
  onEnterHistory: () => void
}

/** Riding overview opened from the main History button. */
export function HistoryDrawer({
  visible,
  triggerRef,
  onClose,
  onEnterHistory,
}: HistoryDrawerProps) {
  const [listMode, setListMode] = useState<ListMode>(null)
  const [loaded, setLoaded] = useState(false)
  const blocks = useHistoryStore((state) => state.blocks)
  const sessions = useHistoryStore((state) => state.sessions)
  const historyLoading = useHistoryStore((state) => state.loading)
  const historyError = useHistoryStore((state) => state.error)
  const hasMore = useHistoryStore((state) => state.hasMore)
  const favorites = useFavoriteStore((state) => state.favorites)
  const favoritesLoading = useFavoriteStore((state) => state.loading)
  const favoritesError = useFavoriteStore((state) => state.error)
  const loadFavorites = useFavoriteStore((state) => state.load)

  useEffect(() => {
    if (!visible) return
    const loadRecentRides = async () => {
      if (useHistoryStore.getState().sessions.length === 0) {
        await useHistoryStore.getState().loadInitial()
      }
      const history = useHistoryStore.getState()
      if (history.sessions.length < 3 && history.hasMore) await history.loadMore()
    }
    void Promise.allSettled([loadRecentRides(), loadFavorites()]).then(() => setLoaded(true))
  }, [loadFavorites, visible])

  const favoriteSessions = useMemo(
    () => favorites.map((favorite) => favoriteToSession(favorite, blocks)),
    [blocks, favorites],
  )

  const enterHistory = useCallback(
    (after: () => void) => {
      setListMode(null)
      onClose()
      onEnterHistory()
      after()
    },
    [onClose, onEnterHistory],
  )

  const openRide = useCallback(
    (session: HistorySession) => {
      enterHistory(() => {
        useMainScreenStore.getState().setHistoryTab('history')
        void useHistoryStore.getState().selectSession(session)
      })
    },
    [enterHistory],
  )

  const openFavorite = useCallback(
    (favorite: Favorite) => {
      enterHistory(() => {
        useMainScreenStore.getState().setHistoryTab('favorites')
        useMainScreenStore.getState().openFavorite(favorite.id)
        void useHistoryStore.getState().selectSession(favoriteToSession(favorite, blocks))
      })
    },
    [blocks, enterHistory],
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
                disabled={!loaded || historyLoading || sessions.length === 0}
                onPress={() => showList('rides')}
              />
            }
          />
          {sessions.length === 0 && (!loaded || historyLoading) ? (
            <ActivityIndicator
              size="small"
              color={theme.palette.purple.color}
              style={styles.loading}
            />
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
              {sessions.slice(0, 3).map((session) => {
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
                    title={formatRideListDateTime(window.startMs, window.endMs)}
                    subtitle={details}
                    routePoints={sessionRoutePoints(blocks, session)}
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
                disabled={!loaded || favoritesLoading || favorites.length === 0}
                onPress={() => showList('favorites')}
              />
            }
          />
          {favorites.length === 0 && (!loaded || favoritesLoading) ? (
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
              {favorites.slice(0, 8).map((favorite) => (
                <FavoriteRideCard
                  key={favorite.id}
                  favorite={favorite}
                  routePoints={sessionRoutePoints(blocks, favoriteToSession(favorite, blocks))}
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
        blocks={blocks}
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

const styles = StyleSheet.create({
  content: {
    padding: 12,
    gap: 12,
  },
  rideList: {
    gap: 8,
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
