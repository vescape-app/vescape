import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import { router } from 'expo-router'
import {
  CaretRightIcon,
  ChartBarIcon,
  ClockCounterClockwiseIcon,
  StarIcon,
  WarningCircleIcon,
} from 'phosphor-react-native'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { TabbedEdgeDrawer, type DrawerTab } from '@/components/overlays/TabbedEdgeDrawer'
import { theme } from '@/constants/theme'
import { HistorySessionRow } from '@/modules/history/components/HistorySessionRow'
import { favoriteToSession } from '@/modules/history/lib/favorites'
import type { HistorySession } from '@/modules/history/lib/sessions'
import { useHistoryAutoRefresh } from '@/modules/history/hooks/useHistoryAutoRefresh'
import { useFavoriteStore, type Favorite } from '@/modules/history/store/favoriteStore'
import { useHistoryStore } from '@/modules/history/store/historyStore'
import { ProfileStatsSummary } from '@/modules/profile/components/ProfileStatsSummary'
import { routes } from '@/navigation/routes'
import { useDrawerTab } from '@/screens/main/overlays/useDrawerTab'

type HistoryTab = 'stats' | 'rides' | 'favorites'

const HISTORY_TABS: readonly DrawerTab<HistoryTab>[] = [
  { id: 'stats', label: 'Stats', icon: ChartBarIcon, color: theme.palette.sky.color },
  {
    id: 'rides',
    label: 'Rides',
    icon: ClockCounterClockwiseIcon,
    color: theme.palette.purple.color,
  },
  { id: 'favorites', label: 'Favorites', icon: StarIcon, color: theme.palette.amber.color },
]

export function useHistoryDrawerTab() {
  return useDrawerTab('historyDrawerTab', HISTORY_TABS, 'rides')
}

interface HistoryDrawerProps {
  visible: boolean
  triggerRef: RefObject<View | null>
  tab: HistoryTab
  onTabChange: (tab: HistoryTab) => void
  onClose: () => void
  onOpenRide: (session: HistorySession) => void
  onOpenFavorite: (favoriteId: string, session: HistorySession) => void
}

/** Riding overview opened from the main History button: totals, every ride, every Favorite. */
export function HistoryDrawer({
  visible,
  triggerRef,
  tab,
  onTabChange,
  onClose,
  onOpenRide,
  onOpenFavorite,
}: HistoryDrawerProps) {
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
      onClose()
      onOpenRide(session)
    },
    [onClose, onOpenRide],
  )

  const openFavorite = useCallback(
    (favorite: Favorite, session: HistorySession) => {
      onClose()
      onOpenFavorite(favorite.id, session)
    },
    [onClose, onOpenFavorite],
  )

  const openStats = useCallback(() => {
    onClose()
    router.push(routes.profileStats)
  }, [onClose])

  const loadMore = useCallback(() => {
    if (!hasMore || historyLoading) return
    void useHistoryStore.getState().loadMore()
  }, [hasMore, historyLoading])

  return (
    <TabbedEdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      side="left"
      tabs={HISTORY_TABS}
      activeTab={tab}
      onTabChange={onTabChange}
      onClose={onClose}
      onReachContentEnd={tab === 'rides' ? loadMore : undefined}
      backdropTestID="history-drawer-backdrop"
      testID="history-drawer"
    >
      {tab === 'stats' ? (
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
      ) : tab === 'rides' ? (
        sessions.length === 0 && (!ridesLoaded || historyLoading) ? (
          <RideListSkeleton />
        ) : sessions.length === 0 && historyError ? (
          <Placeholder
            icon={WarningCircleIcon}
            title="Could not load rides"
            description="Restart the app to try again"
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
          <View style={styles.list}>
            {sessions.map((session, index) => (
              <HistorySessionRow
                key={session.id}
                testID={index === 0 ? 'history-latest-ride' : undefined}
                session={session}
                onPress={() => openRide(session)}
              />
            ))}
            {hasMore ? (
              <Button
                label="Load older rides"
                size="sm"
                variant="secondary"
                loading={historyLoading}
                onPress={loadMore}
              />
            ) : null}
          </View>
        )
      ) : favorites.length === 0 && (!favoritesLoaded || favoritesLoading) ? (
        <ActivityIndicator size="small" color={theme.palette.amber.color} style={styles.loading} />
      ) : favorites.length === 0 && favoritesError ? (
        <Placeholder
          icon={WarningCircleIcon}
          title="Could not load favorites"
          description="Try loading favorites again"
          action={<Button label="Retry" size="sm" variant="secondary" onPress={loadFavorites} />}
          style={styles.placeholder}
        />
      ) : favorites.length === 0 ? (
        <Placeholder
          icon={StarIcon}
          title="No favorites yet"
          description="Star a stretch of a ride in History to keep it here"
          style={styles.placeholder}
        />
      ) : (
        <View style={styles.list}>
          {favorites.map((favorite, index) => (
            <HistorySessionRow
              key={favorite.id}
              session={favoriteSessions[index]}
              favorite={favorite}
              onPress={() => openFavorite(favorite, favoriteSessions[index])}
            />
          ))}
        </View>
      )}
    </TabbedEdgeDrawer>
  )
}

function RideListSkeleton() {
  return (
    <View style={styles.list} accessibilityLabel="Loading recent rides">
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.rideSkeleton} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  list: {
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
  placeholder: {
    minHeight: 220,
    paddingVertical: 24,
  },
  loading: {
    marginVertical: 70,
  },
})
