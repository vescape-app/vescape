import * as Haptics from 'expo-haptics'
import { ClockCounterClockwiseIcon, SirenIcon, SlidersHorizontalIcon } from 'phosphor-react-native'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { IconButton } from '@/components/base/IconButton'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { theme } from '@/constants/theme'
import { FloatingBar } from '@/modules/board/components/FloatingBar'
import type { Board } from '@/modules/board/store/boardStore'
import type { HistorySession } from '@/modules/history/store/historyStore'
import type { MainMapHandle } from '@/screens/main/map/MainMap'
import { MapRevealGesture } from '@/screens/main/map/MapRevealGesture'
import {
  OffscreenMapIndicator,
  type OffscreenMapIndicatorState,
} from '@/screens/main/map/offscreenMapIndicators'
import type { MainViewState } from '@/screens/main/mainViewState'
import {
  BottomTelemetryStrip,
  STRIP_CONTENT_HEIGHT,
} from '@/screens/main/overlays/BottomTelemetryStrip'
import { LiveHud } from '@/screens/main/overlays/LiveHud'
import { TopBar } from '@/screens/main/overlays/TopBar'
import { BoardDrawer } from '@/screens/main/overlays/BoardDrawer'
import { HistoryDrawer } from '@/screens/main/overlays/HistoryDrawer'
import type { MapSelection } from '@/modules/map/lib/mapSelection'

const RECORD_BUTTON_HEIGHT = 48
const HISTORY_BUTTON_SIZE = 54
const TELEMETRY_FADE_TIMING = { duration: 260 } as const

interface TelemetryOverlayProps {
  mode: MainViewState
  mapRef: RefObject<MainMapHandle | null>
  /** Drives the map's parallax while the rider drags the telemetry face away. */
  revealProgress: SharedValue<number>
  /** Fades this overlay (and the map vignette) out as the drag commits. */
  dragOpacity: SharedValue<number>
  boards: Board[]
  activeBoardId: string | null
  activeBoard: Board | undefined
  bleStatus: string
  offscreenMapIndicators: OffscreenMapIndicatorState[]
  onSelectBoard: (id: string) => void
  onAddBoard: () => void
  onStopScan: () => void
  onRetryConnect: () => void
  onEnterMapFocus: () => void
  /** Undoes an accidental reveal when the drag turns out to be a pinch. */
  onCancelMapFocus: () => void
  onEnterWeather: () => void
  onEnterLegalLimits: () => void
  onOpenHistoryRide: (session: HistorySession) => void
  onOpenHistoryFavorite: (favoriteId: string, session: HistorySession) => void
  onOffscreenIndicatorPress: (indicator: OffscreenMapIndicatorState) => void
  activeNavigationTarget: MapSelection | null
  onCancelNavigation: () => void
}

/**
 * The riding face: live HUD, telemetry strip, board bar, and the drag that reveals the map behind
 * it. Stays mounted in every mode and fades itself out, so returning to it is a fade and not a
 * remount.
 */
export function TelemetryOverlay({
  mode,
  mapRef,
  revealProgress,
  dragOpacity,
  boards,
  activeBoardId,
  activeBoard,
  bleStatus,
  offscreenMapIndicators,
  onSelectBoard,
  onAddBoard,
  onStopScan,
  onRetryConnect,
  onEnterMapFocus,
  onCancelMapFocus,
  onEnterWeather,
  onEnterLegalLimits,
  onOpenHistoryRide,
  onOpenHistoryFavorite,
  onOffscreenIndicatorPress,
  activeNavigationTarget,
  onCancelNavigation,
}: TelemetryOverlayProps) {
  const insets = useSafeAreaInsets()
  const [revealGestureActive, setRevealGestureActive] = useState(false)
  const [tuneDrawerOpen, setTuneDrawerOpen] = useState(false)
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false)
  const historyButtonRef = useRef<View>(null)
  const revealCommittedRef = useRef(false)
  const tuneButtonRef = useRef<View>(null)
  // Derived, not effect-driven: the fade follows `mode` from the first evaluation on, so a Fast
  // Refresh that re-renders without re-running effects can never leave the face stuck invisible.
  const telemetryReturnOpacity = useDerivedValue(() =>
    withTiming(mode === 'telemetry' ? 1 : 0, TELEMETRY_FADE_TIMING),
  )

  const aboveStripBottom = STRIP_CONTENT_HEIGHT + Math.max(insets.bottom * 0.5, 8) + 8
  const buttonBottom = aboveStripBottom - (HISTORY_BUTTON_SIZE - RECORD_BUTTON_HEIGHT) / 2
  const legalModeActive = activeBoard?.legalMode?.enabled ?? false
  const interactive = mode === 'telemetry' && !revealGestureActive

  const interfaceFadeStyle = useAnimatedStyle(() => ({
    opacity: (1 - dragOpacity.value) * telemetryReturnOpacity.value,
  }))

  const handleRevealPanStart = useCallback(() => {
    mapRef.current?.beginPreviewPan()
  }, [mapRef])

  const handleRevealPan = useCallback(
    (totalX: number, totalY: number, progress: number) => {
      mapRef.current?.previewPanBy(totalX, totalY, progress)
    },
    [mapRef],
  )

  const handleRevealZoomStart = useCallback(() => {
    mapRef.current?.beginPreviewZoom()
  }, [mapRef])

  const handleRevealZoom = useCallback(
    (scale: number) => {
      mapRef.current?.previewZoomBy(scale)
    },
    [mapRef],
  )

  const handleRevealZoomEnd = useCallback(() => {
    mapRef.current?.endPreviewZoom()
  }, [mapRef])

  const handleReveal = useCallback(() => {
    if (Platform.OS === 'ios') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    } else if (Platform.OS === 'android') {
      void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)
    }
    revealCommittedRef.current = true
    setRevealGestureActive(true)
    onEnterMapFocus()
  }, [onEnterMapFocus])

  const handleRevealCancel = useCallback(() => {
    if (!revealCommittedRef.current) return
    revealCommittedRef.current = false
    mapRef.current?.restorePreviewPan()
    onCancelMapFocus()
  }, [mapRef, onCancelMapFocus])

  const handleRevealFinish = useCallback(
    (revealed: boolean) => {
      const actuallyRevealed = revealed || revealCommittedRef.current || mode === 'map'
      if (!actuallyRevealed) {
        mapRef.current?.restorePreviewPan()
      } else {
        mapRef.current?.endPreviewPan()
      }
      revealCommittedRef.current = false
      setRevealGestureActive(false)
    },
    [mapRef, mode],
  )

  useEffect(() => {
    if (mode === 'telemetry') revealCommittedRef.current = false
  }, [mode])

  return (
    <>
      <MapRevealGesture
        enabled={mode === 'telemetry' || revealGestureActive}
        progress={revealProgress}
        dragOpacity={dragOpacity}
        onPanStart={handleRevealPanStart}
        onPan={handleRevealPan}
        onZoomStart={handleRevealZoomStart}
        onZoom={handleRevealZoom}
        onZoomEnd={handleRevealZoomEnd}
        onReveal={handleReveal}
        onRevealCancel={handleRevealCancel}
        onFinish={handleRevealFinish}
      >
        <Animated.View
          pointerEvents={interactive ? 'box-none' : 'none'}
          style={[styles.telemetryInterface, interfaceFadeStyle]}
        >
          <LiveHud revealProgress={revealProgress} />
          <BottomTelemetryStrip revealProgress={revealProgress} />
          <TopBar
            boards={boards}
            activeBoardId={activeBoardId}
            activeBoard={activeBoard}
            bleStatus={bleStatus}
            onSelectBoard={onSelectBoard}
            onAddBoard={onAddBoard}
            onDisconnect={onStopScan}
            onWeatherPress={onEnterWeather}
            activeNavigationTarget={activeNavigationTarget}
            onNavigationPress={onEnterMapFocus}
            onCancelNavigation={onCancelNavigation}
          />
          <FloatingBar
            bleStatus={bleStatus}
            activeBoard={activeBoard}
            onStopScan={onStopScan}
            onRetryConnect={onRetryConnect}
            bottomOffset={aboveStripBottom}
          />
          <View
            ref={historyButtonRef}
            collapsable={false}
            style={[styles.historyButton, { bottom: buttonBottom }]}
          >
            <IconButton
              icon={ClockCounterClockwiseIcon}
              size="lg"
              onPress={() => setHistoryDrawerOpen(true)}
              testID="history-button"
            />
          </View>
          <HistoryDrawer
            visible={historyDrawerOpen}
            triggerRef={historyButtonRef}
            onClose={() => setHistoryDrawerOpen(false)}
            onOpenRide={onOpenHistoryRide}
            onOpenFavorite={onOpenHistoryFavorite}
          />
          <View
            ref={tuneButtonRef}
            collapsable={false}
            style={[styles.tuneButton, { bottom: buttonBottom }]}
          >
            <IconButton
              icon={legalModeActive ? SirenIcon : SlidersHorizontalIcon}
              size="lg"
              accent={legalModeActive ? theme.status.error.color : undefined}
              onPress={() => setTuneDrawerOpen(true)}
            />
          </View>
          <EdgeDrawer
            visible={tuneDrawerOpen}
            triggerRef={tuneButtonRef}
            title="Board"
            icon={SlidersHorizontalIcon}
            onClose={() => setTuneDrawerOpen(false)}
          >
            <BoardDrawer
              onNavigate={() => setTuneDrawerOpen(false)}
              onOpenLegalLimits={() => {
                setTuneDrawerOpen(false)
                onEnterLegalLimits()
              }}
            />
          </EdgeDrawer>
        </Animated.View>
      </MapRevealGesture>

      <View pointerEvents={interactive ? 'box-none' : 'none'} style={styles.offscreenIndicators}>
        {mode === 'telemetry'
          ? offscreenMapIndicators.map((indicator) => (
              <OffscreenMapIndicator
                key={indicator.id}
                indicator={indicator}
                onPress={() => onOffscreenIndicatorPress(indicator)}
              />
            ))
          : null}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  telemetryInterface: {
    ...StyleSheet.absoluteFill,
    zIndex: 6,
  },
  offscreenIndicators: {
    ...StyleSheet.absoluteFill,
    zIndex: 40,
  },
  historyButton: {
    position: 'absolute',
    left: 12,
    zIndex: 20,
  },
  tuneButton: {
    position: 'absolute',
    right: 12,
    zIndex: 20,
  },
})
