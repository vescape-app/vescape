import { forwardRef, useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  ArrowFatLinesUpIcon,
  BroadcastIcon,
  ArrowsClockwiseIcon,
  CaretDownIcon,
  GearSixIcon,
  PencilSimpleIcon,
  PowerIcon,
  UsersThreeIcon,
} from 'phosphor-react-native'
import { router } from 'expo-router'
import { useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BoardSelectorSheet } from '@/modules/board/components/BoardSelectorSheet'
import { EdgeDrawer } from '@/components/overlays/AnchoredSheet'
import { IconButton } from '@/components/base/IconButton'
import { WeatherStat } from '@/modules/weather/components/WeatherStat'
import { SocialSheet } from '@/modules/group-ride/components/SocialSheet'
import { SettingsSheet } from '@/screens/main/overlays/SettingsSheet'
import { BoardWarningControl } from '@/modules/board/components/BoardWarningControl'
import { ReplayBadge } from '@/modules/board/components/ReplayBadge'
import { useBleStore } from '@/modules/board/store/bleStore'
import { isReplayBoardId } from 'vescape-core'
import { isNightAtTime } from '@/modules/weather/lib/weather'
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
import { distanceMeters } from '@/helpers/mapGeometry'
import { fmtDistance } from '@/helpers/format'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { PrototypeSwitcher } from '@/components/dev/PrototypeSwitcher'
import {
  NavigationTopBarPrototype,
  type NavigationTopBarPrototypeVariant,
  WeatherSidePillPrototype,
} from '@/screens/main/overlays/NavigationTopBarPrototype'

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
  currentLocation: { latitude: number; longitude: number } | null
  onCancelNavigation: () => void
}

interface BoardPillProps {
  activeBoardId: string | null
  activeBoard: Board | undefined
  bleStatus: string
  isReplay: boolean
  onOpenSelector: () => void
  onDisconnect: () => void
}

function readPrototypeVariant(
  value: string | string[] | undefined,
): NavigationTopBarPrototypeVariant | null {
  if (!__DEV__) return null
  const variant = Array.isArray(value) ? value[0] : value
  return variant === 'A' || variant === 'B' || variant === 'C' ? variant : null
}

/** The board identity pill: selector, edit, disconnect and the Board Warning control. */
const BoardPill = forwardRef<View, BoardPillProps>(function BoardPill(
  { activeBoardId, activeBoard, bleStatus, isReplay, onOpenSelector, onDisconnect },
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
        : theme.palette.slate.textSecondary

  return (
    <View ref={ref} style={styles.pill}>
      <Pressable
        style={styles.boardButton}
        onPress={onOpenSelector}
        testID="board-selector-trigger"
        accessibilityLabel="Board selector"
      >
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        {isReplay && showDevControls && <ReplayBadge />}
        <Text style={styles.boardText} numberOfLines={1}>
          {name}
        </Text>
        <CaretDownIcon size={12} color={theme.palette.slate.textSecondary} weight="bold" />
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
          color={activeBoard ? theme.palette.slate.textPrimary : theme.palette.slate.textMuted}
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
      {activeBoardId && <BoardWarningControl boardId={activeBoardId} />}
    </View>
  )
})

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
  currentLocation,
  onCancelNavigation,
}: TopBarProps) {
  const insets = useSafeAreaInsets()
  const pillRef = useRef<View>(null)
  const socialRef = useRef<View>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [socialOpen, setSocialOpen] = useState(false)
  const settingsRef = useRef<View>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const params = useLocalSearchParams<{ variant?: string | string[] }>()
  const prototypeVariant = readPrototypeVariant(params.variant)
  const riderColor = useRiderStore((s) => s.riderColor) ?? theme.palette.green.color

  const isReplay = useBleStore((s) => isReplayBoardId(s.connectedId))
  const nearbyBadge = useGroupRideStore((s) => s.badge)
  const rideActive = useGroupRideStore((s) => s.activeRideId !== null)
  const weatherCode = useWeatherStore((s) => s.weatherCode)
  const weatherTemp = useWeatherStore((s) => s.temperature)
  const weatherPrecip = useWeatherStore((s) => s.precipitationProbability)
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
  const sunrise = useWeatherStore((s) => s.sunrise)
  const sunset = useWeatherStore((s) => s.sunset)
  const hasWeather = weatherCode != null && weatherTemp != null
  const now = new Date()
  const isNight = isNightAtTime(now.getHours(), now.getMinutes(), sunrise, sunset)
  const prototypeTarget = activeNavigationTarget ?? {
    type: 'coordinate' as const,
    id: 'prototype-bonk-target',
    latitude: 50.0616,
    longitude: 19.9383,
    title: 'Bonk spot',
    subtitle: null,
  }
  const prototypeTargetKind =
    activeNavigationTarget?.type === 'mapPoint'
      ? activeNavigationTarget.point.category
      : activeNavigationTarget
        ? 'direction'
        : 'bonk'
  const prototypeDistance =
    activeNavigationTarget && currentLocation
      ? distanceMeters(currentLocation, activeNavigationTarget)
      : 184

  return (
    <View
      style={[
        styles.wrap,
        prototypeVariant && styles.prototypeWrap,
        { paddingTop: Math.max(insets.top, 8) },
      ]}
      pointerEvents="box-none"
    >
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
        {prototypeVariant ? (
          <View ref={pillRef} collapsable={false}>
            <NavigationTopBarPrototype
              variant={prototypeVariant}
              boardName={activeBoard?.name ?? 'Thor Hammer'}
              connected={bleStatus === 'connected' || bleStatus === 'stale'}
              targetTitle={prototypeTarget.title}
              targetKind={prototypeTargetKind}
              distanceLabel={fmtDistance(prototypeDistance)}
              riderColor={riderColor}
              onBoardPress={() => setSelectorOpen(true)}
              onCancel={onCancelNavigation}
            />
          </View>
        ) : (
          <BoardPill
            ref={pillRef}
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
      {hasWeather && prototypeVariant !== 'C' && (
        <Pressable style={styles.weatherRow} onPress={onWeatherPress}>
          <WeatherStat
            code={weatherCode!}
            temperature={weatherTemp!}
            hour={now.getHours()}
            isNight={isNight}
            precipProbability={weatherPrecip}
            size="sm"
          />
        </Pressable>
      )}
      {hasWeather && prototypeVariant === 'C' ? (
        <WeatherSidePillPrototype
          code={weatherCode!}
          temperature={weatherTemp!}
          precipProbability={weatherPrecip ?? null}
          hour={now.getHours()}
          isNight={isNight}
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
        <SocialSheet onNavigate={() => setSocialOpen(false)} />
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
      {prototypeVariant ? (
        <PrototypeSwitcher
          current={prototypeVariant}
          variants={[
            { key: 'A', label: 'Separate pills' },
            { key: 'B', label: 'Joined rail' },
            { key: 'C', label: 'Target first' },
          ]}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  prototypeWrap: {
    bottom: 0,
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
    right: 10,
  },
  iconLeft: {
    position: 'absolute',
    left: 10,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
    overflow: 'hidden',
  },
  boardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 8,
    minHeight: 38,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  boardText: {
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    maxWidth: 120,
    flexShrink: 1,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: theme.palette.slate.border,
  },
  plugButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weatherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
})
