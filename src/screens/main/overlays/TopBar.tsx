import { forwardRef, useRef, useState } from 'react'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  ArrowFatLinesUpIcon,
  BroadcastIcon,
  ArrowsClockwiseIcon,
  CaretDownIcon,
  GearSixIcon,
  PencilSimpleIcon,
  PowerIcon,
  RecordIcon,
  UsersThreeIcon,
} from 'phosphor-react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BoardSelectorSheet } from '@/modules/board/components/BoardSelectorSheet'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { IconButton } from '@/components/base/IconButton'
import { SocialSheet } from '@/modules/group-ride/components/SocialSheet'
import { SettingsSheet } from '@/screens/main/overlays/SettingsSheet'
import { BoardWarningControl } from '@/modules/board/components/BoardWarningControl'
import { ReplayBadge } from '@/modules/board/components/ReplayBadge'
import { useBleStore } from '@/modules/board/store/bleStore'
import { isReplayBoardId } from 'vescape-core'
import { routes } from '@/navigation/routes'
import { showDevControls } from '@/config/env'
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

interface BoardPillProps {
  maxWidth: number
  activeBoardId: string | null
  activeBoard: Board | undefined
  bleStatus: string
  isReplay: boolean
  onOpenSelector: () => void
  onDisconnect: () => void
}

/** The board identity pill: selector, edit, disconnect and the Board Warning control. */
const BoardPill = forwardRef<View, BoardPillProps>(function BoardPill(
  { maxWidth, activeBoardId, activeBoard, bleStatus, isReplay, onOpenSelector, onDisconnect },
  ref,
) {
  const canDisconnect =
    bleStatus === 'connected' ||
    bleStatus === 'stale' ||
    bleStatus === 'reconnecting' ||
    bleStatus === 'rescanning' ||
    bleStatus === 'waiting_for_telemetry'
  const name = activeBoard?.name ?? 'No board'
  const statusColor =
    bleStatus === 'connected'
      ? theme.palette.green.color
      : bleStatus === 'error'
        ? theme.status.error.color
        : theme.control.textMuted

  return (
    <View ref={ref} style={[styles.pill, { maxWidth }]}>
      <Pressable
        style={styles.boardButton}
        onPress={onOpenSelector}
        testID="board-selector-trigger"
        // The board's name, not a static label: an `accessibilityLabel` replaces the children in
        // the iOS accessibility tree, so a fixed string hides which board is selected from both
        // VoiceOver and the flows that assert on it.
        accessibilityLabel={`${name}, board selector`}
      >
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        {isReplay && showDevControls && <ReplayBadge />}
        <Text style={styles.boardText} numberOfLines={1}>
          {name}
        </Text>
        <CaretDownIcon size={12} color={theme.control.textMuted} weight="bold" />
      </Pressable>
      <View style={styles.divider} />
      <Pressable
        style={[styles.plugButton, !activeBoard && styles.iconRoundDisabled]}
        disabled={!activeBoard}
        onPress={() => {
          if (!activeBoard) return
          router.push({ pathname: routes.editBoard, params: { boardId: activeBoard.id } })
        }}
        testID="board-edit-button"
      >
        <PencilSimpleIcon
          size={14}
          color={activeBoard ? theme.control.text : theme.control.textMuted}
          weight="bold"
        />
      </Pressable>
      {canDisconnect && (
        <>
          <View style={styles.divider} />
          <Pressable
            style={styles.plugButton}
            onPress={onDisconnect}
            testID="board-disconnect-button"
          >
            <PowerIcon size={15} color={theme.status.error.color} weight="bold" />
          </Pressable>
        </>
      )}
      <DebugRecordingControl />
      {activeBoardId && <BoardWarningControl boardId={activeBoardId} />}
    </View>
  )
})

/** Dev-only "session is being recorded" indicator; tapping it stops the recording. */
function DebugRecordingControl() {
  const recording = useBleStore((s) => s.recordDebugSession)
  const setRecording = useBleStore((s) => s.setRecordDebugSession)
  if (!showDevControls || !recording) return null

  return (
    <>
      <View style={styles.divider} />
      <Pressable
        style={styles.plugButton}
        onPress={() => setRecording(false)}
        testID="debug-recording-button"
        accessibilityLabel="Debug recording active"
      >
        <RecordIcon size={14} color={theme.status.warning.color} weight="bold" />
      </Pressable>
    </>
  )
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
                <BoardPill
                  maxWidth={boardPillMaxWidth}
                  activeBoardId={activeBoardId}
                  activeBoard={activeBoard}
                  bleStatus={bleStatus}
                  isReplay={isReplay}
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
          <BoardPill
            ref={pillRef}
            maxWidth={boardPillMaxWidth}
            activeBoardId={activeBoardId}
            activeBoard={activeBoard}
            bleStatus={bleStatus}
            isReplay={isReplay}
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
  iconRoundDisabled: {
    opacity: 0.4,
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
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: theme.control.border,
    backgroundColor: theme.control.background,
    overflow: 'hidden',
  },
  boardButton: {
    flexDirection: 'row',
    flexShrink: 1,
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 8,
    minHeight: 38,
    minWidth: 0,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  boardText: {
    color: theme.control.text,
    fontSize: 13,
    fontWeight: '800',
    maxWidth: 180,
    flexShrink: 1,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: theme.control.divider,
  },
  plugButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
