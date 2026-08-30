import { useRef, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import {
  ArrowFatLinesUpIcon,
  BroadcastIcon,
  ArrowsClockwiseIcon,
  GearSixIcon,
  UsersThreeIcon,
} from 'phosphor-react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BoardSelectorSheet } from '@/modules/board/components/BoardSelectorSheet'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { IconButton } from '@/components/base/IconButton'
import { SocialSheet } from '@/modules/group-ride/components/SocialSheet'
import { SettingsSheet } from '@/screens/main/overlays/SettingsSheet'
import { ConnectedBoardPill } from '@/modules/board/components/ConnectedBoardPill'
import { useBleStore } from '@/modules/board/store/bleStore'
import { isReplayBoardId } from 'vescape-core'
import { routes } from '@/navigation/routes'
import type { Board } from '@/modules/board/store/boardStore'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import { useWeatherStore } from '@/modules/weather/store/weatherStore'
import { theme } from '@/constants/theme'
import { selectAvailableUpdate } from '@/modules/release/lib/availableUpdate'
import { settingsTriggerState } from '@/screens/main/overlays/settingsTrigger'
import { useAppStatusStore } from '@/modules/release/store/appStatusStore'
import { useBackupSlot } from '@/modules/profile/hooks/useBackupSlot'
import type { MapSelection } from '@/modules/map/lib/mapSelection'
import { DASH, fmtDistance } from '@/helpers/format'
import { useMapStore } from '@/modules/map/store/mapStore'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { ActiveNavigationTopBar } from '@/screens/main/overlays/ActiveNavigationTopBar'
import { WeatherSidePill } from '@/screens/main/overlays/WeatherSidePill'
import {
  getMapPointKindIcon,
  getPlaceCategoryIcon,
} from '@/modules/map-points/constants/mapPointIcons'

interface TopBarProps {
  boards: Board[]
  activeBoardId: string | null
  activeBoard: Board | undefined
  bleStatus: string
  onSelectBoard: (id: string) => void
  onAddBoard: () => void
  onDisconnect: () => void
  onWeatherPress?: () => void
  activeNavigationTarget: MapSelection | null
  onNavigationPress: () => void
  onCancelNavigation: () => void
}

export function TopBar({
  boards,
  activeBoardId,
  activeBoard,
  bleStatus,
  onSelectBoard,
  onAddBoard,
  onDisconnect,
  onWeatherPress,
  activeNavigationTarget,
  onNavigationPress,
  onCancelNavigation,
}: TopBarProps) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const boardPillMaxWidth = width - 116
  const pillRef = useRef<View>(null)
  const socialRef = useRef<View>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [socialOpen, setSocialOpen] = useState(false)
  const settingsRef = useRef<View>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const riderColor = useRiderStore((s) => s.riderColor) ?? theme.palette.green.color
  const routeProgress = useMapStore((s) => s.routeProgress)

  const isReplay = useBleStore((s) => isReplayBoardId(s.connectedId))
  const connectedId = useBleStore((s) => s.connectedId)
  // Faults belong to whichever board the live session writes under — a replay's synthetic board
  // while it plays, the selected board otherwise.
  const sessionBoardId = isReplay ? connectedId : activeBoardId
  const nearbyBadge = useGroupRideStore((s) => s.badge)
  const rideActive = useGroupRideStore((s) => s.activeRideId !== null)
  const weather = useWeatherStore((s) => s.weather)
  const appStatus = useAppStatusStore((s) => s.status)
  const availableUpdate = selectAvailableUpdate(appStatus)
  // A Release Policy warning escalates the gear itself; a merely newer version stays a quiet dot.
  const versionWarning =
    appStatus?.version.status === 'update-warning' || appStatus?.version.status === 'online-blocked'
  const backup = useBackupSlot()
  const trigger = settingsTriggerState({
    versionWarning,
    updateAvailable: availableUpdate !== null,
    backup,
  })
  const navigationTargetIcon =
    activeNavigationTarget?.type === 'mapPoint'
      ? getMapPointKindIcon(activeNavigationTarget.point.category)
      : activeNavigationTarget?.type === 'place'
        ? getPlaceCategoryIcon(activeNavigationTarget.category)
        : getMapPointKindIcon('direction')
  // Along the path, from native. A straight line here claimed 679 m for a ride that is 2 km around
  // the river; the dash while native has no Route Progress is the honest answer, not a reason to
  // fall back to one.
  const navigationDistance =
    routeProgress && activeNavigationTarget ? fmtDistance(routeProgress.remainingMeters) : DASH

  return (
    <View style={[styles.wrap, { paddingTop: Math.max(insets.top, 8) }]} pointerEvents="box-none">
      <View style={styles.row}>
        <View ref={socialRef} collapsable={false} style={styles.iconLeft}>
          <IconButton
            icon={rideActive ? BroadcastIcon : UsersThreeIcon}
            onPress={() => setSocialOpen(true)}
            accessibilityLabel="Social"
            testID="social-drawer-trigger"
            dot={nearbyBadge && !rideActive ? theme.palette.groupRide.color : undefined}
            accent={rideActive ? theme.palette.groupRide.color : undefined}
          />
        </View>
        {activeNavigationTarget ? (
          <View ref={pillRef} collapsable={false}>
            <ActiveNavigationTopBar
              boardPill={
                <ConnectedBoardPill
                  maxWidth={boardPillMaxWidth}
                  activeBoardId={activeBoardId}
                  activeBoard={activeBoard}
                  bleStatus={bleStatus}
                  isReplay={isReplay}
                  sessionBoardId={sessionBoardId}
                  onOpenSelector={() => setSelectorOpen(true)}
                  onDisconnect={onDisconnect}
                />
              }
              maxWidth={Math.min(boardPillMaxWidth, 240)}
              boardName={activeBoard?.name ?? 'No board'}
              connected={bleStatus === 'connected' || bleStatus === 'stale'}
              targetTitle={activeNavigationTarget.title}
              targetIcon={navigationTargetIcon}
              distanceLabel={navigationDistance}
              riderColor={riderColor}
              onNavigationPress={onNavigationPress}
              onCancel={onCancelNavigation}
            />
          </View>
        ) : (
          <ConnectedBoardPill
            ref={pillRef}
            maxWidth={boardPillMaxWidth}
            activeBoardId={activeBoardId}
            activeBoard={activeBoard}
            bleStatus={bleStatus}
            isReplay={isReplay}
            sessionBoardId={sessionBoardId}
            onOpenSelector={() => setSelectorOpen(true)}
            onDisconnect={onDisconnect}
          />
        )}
        {/* The gear wears whatever is happening inside the drawer — a required update, or a
            running backup with its progress — the same way Social wears an active Group Ride. */}
        <View ref={settingsRef} collapsable={false} style={styles.iconRight}>
          <IconButton
            icon={GearSixIcon}
            takeover={
              trigger.takeover
                ? {
                    icon: trigger.takeover === 'update' ? ArrowFatLinesUpIcon : ArrowsClockwiseIcon,
                    accent: trigger.accent,
                    progress: trigger.progress,
                  }
                : null
            }
            onPress={() => setSettingsOpen(true)}
            onLongPress={() => router.push(routes.settingsComponents)}
            dot={trigger.dot}
            accessibilityLabel={trigger.accessibilityLabel}
            testID="settings-drawer-trigger"
          />
        </View>
      </View>
      {weather ? (
        <WeatherSidePill
          icon={weather.icon}
          temperature={weather.temperatureC}
          precipProbability={weather.precipitationProbability}
          verticalOffset={insets.top / 2}
          onPress={onWeatherPress}
        />
      ) : null}

      <EdgeDrawer
        visible={socialOpen}
        triggerRef={socialRef}
        edge="top"
        title="Social"
        icon={UsersThreeIcon}
        backdropTestID="social-drawer-backdrop"
        onClose={() => setSocialOpen(false)}
      >
        <SocialSheet />
      </EdgeDrawer>

      <EdgeDrawer
        visible={settingsOpen}
        triggerRef={settingsRef}
        edge="top"
        backdropTestID="settings-drawer-backdrop"
        onClose={() => setSettingsOpen(false)}
      >
        <SettingsSheet backup={backup} onNavigate={() => setSettingsOpen(false)} />
      </EdgeDrawer>

      <BoardSelectorSheet
        visible={selectorOpen}
        triggerRef={pillRef}
        boards={boards}
        activeBoardId={activeBoardId}
        activeBoardLive={bleStatus === 'connected' || bleStatus === 'stale'}
        onClose={() => setSelectorOpen(false)}
        onSelectBoard={(id) => {
          onSelectBoard(id)
          setSelectorOpen(false)
        }}
        onAddBoard={() => {
          setSelectorOpen(false)
          onAddBoard()
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  iconRight: {
    position: 'absolute',
    top: 0,
    right: 10,
  },
  iconLeft: {
    position: 'absolute',
    top: 0,
    left: 10,
  },
})
