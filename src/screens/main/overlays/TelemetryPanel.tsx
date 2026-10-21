import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler'
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { ExportIcon } from 'phosphor-react-native'
import { exportLiveTelemetryCsv } from 'vescape-core'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { IconButton } from '@/components/base/IconButton'
import { InfoModal } from '@/components/modals/InfoModal'
import { theme } from '@/constants/theme'
import { LiveTelemetryList } from '@/modules/board/components/LiveTelemetryList'
import { shareExportFile } from '@/modules/history/lib/shareRideExport'

/** Drag, or a flick, past which a released drag settles the other way; short of it, it springs
 * back. */
const SETTLE_DISTANCE = 64
const SETTLE_VELOCITY = 500
/** Share of the open at which the strip and the floating controls are fully gone. */
const FADE_END = 0.2
/** Vertical drift of the strip and the floating controls as they fade, toward the panel. */
const FADE_LIFT = 24
// Clamped: an overshoot past open would lift the sheet off the bottom edge.
const SPRING = { damping: 20, stiffness: 180, mass: 0.8, overshootClamping: true } as const

export interface TelemetryPanelState {
  /** 0 closed, 1 open; drives the sheet, the strip and the controls it hides. */
  progress: SharedValue<number>
  /** Sheet height, measured; the drag maps finger travel against it. */
  sheetHeight: SharedValue<number>
  /** Committed open: the strip and floating controls take no touches. Not set mid-drag, where
   * dropping touches on the strip would cancel the drag that is pulling it. */
  active: boolean
  /** Whether the list is mounted (and native streams its series). */
  mounted: boolean
  /** Upward drag on the strip. */
  openGesture: GestureType
  /** Springs the panel shut. A worklet, so a gesture can call it without a JS round trip. */
  close: () => void
  /** Springs the panel open, for a tap on the strip's handle. */
  open: () => void
}

/**
 * Whether a released drag carries on to the far side. `travel` and `velocity` point that way. The
 * last movement decides over the distance: flicked back, a drag returns however far it went.
 */
function settlesAcross(travel: number, velocity: number) {
  'worklet'
  if (velocity > SETTLE_VELOCITY) return true
  if (velocity < -SETTLE_VELOCITY) return false
  return travel > SETTLE_DISTANCE
}

/**
 * The telemetry panel's open state and the drag that opens it. The sheet follows the finger up
 * from the strip and, released, springs open or back as `settlesAcross` decides.
 */
// Reanimated shared values are mutable handles by design.
/* eslint-disable react-hooks/immutability */
export function useTelemetryPanel(enabled: boolean): TelemetryPanelState {
  const progress = useSharedValue(0)
  const { height: windowHeight } = useWindowDimensions()
  // Until the list first lays out, the screen height stands in for the sheet's.
  const sheetHeight = useSharedValue(windowHeight)
  const started = useSharedValue(false)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  const settleClosed = useCallback(() => {
    setOpen(false)
    setMounted(false)
  }, [])

  const close = useCallback(() => {
    'worklet'
    progress.value = withSpring(0, SPRING, (finished) => {
      if (finished) scheduleOnRN(settleClosed)
    })
  }, [progress, settleClosed])

  const openPanel = useCallback(() => {
    setMounted(true)
    progress.value = withSpring(1, SPRING)
    setOpen(true)
  }, [progress])

  const openGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled && !open)
        .maxPointers(1)
        // Up activates; a downward or sideways drag fails it, leaving taps to the strip's buttons.
        .activeOffsetY(-10)
        .failOffsetY(8)
        .failOffsetX([-24, 24])
        .onStart(() => {
          started.value = true
          scheduleOnRN(setMounted, true)
        })
        .onUpdate((event) => {
          progress.value = Math.min(1, Math.max(0, -event.translationY) / sheetHeight.value)
        })
        .onFinalize((event, success) => {
          // A tap on the strip's buttons, or a drag that failed, never moved anything.
          if (!started.value) return
          started.value = false
          if (success && settlesAcross(-event.translationY, -event.velocityY)) {
            progress.value = withSpring(1, SPRING)
            scheduleOnRN(setOpen, true)
          } else {
            close()
          }
        }),
    [close, enabled, open, progress, sheetHeight, started],
  )

  // Hardware back closes the panel before it leaves the screen — only while home is in front, or
  // it would swallow the back press of a detail screen opened from the panel.
  useFocusEffect(
    useCallback(() => {
      if (!open) return
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        close()
        return true
      })
      return () => subscription.remove()
    }, [close, open]),
  )

  // Leaving the telemetry face drops the panel at once; it is not a place to come back to.
  useEffect(() => {
    if (enabled) return
    progress.value = 0
    settleClosed()
  }, [enabled, progress, settleClosed])

  return { progress, sheetHeight, active: open, mounted, openGesture, close, open: openPanel }
}
/* eslint-enable react-hooks/immutability */

/** Fades and lifts what the panel replaces — the strip and the floating controls — as it opens. */
export function useTelemetryPanelFadeStyle(progress: SharedValue<number>) {
  return useAnimatedStyle(() => {
    const t = interpolate(progress.value, [0, FADE_END], [0, 1], Extrapolation.CLAMP)
    return { opacity: 1 - t, transform: [{ translateY: -FADE_LIFT * t }] }
  })
}

interface TelemetryPanelProps {
  panel: TelemetryPanelState
}

/**
 * What the strip opens into: a drawer-style scrim over the whole face with every live metric on it.
 * Tapping the scrim or pulling down anywhere closes it.
 */
// Reanimated shared values are mutable handles by design.
/* eslint-disable react-hooks/immutability */
export function TelemetryPanel({ panel }: TelemetryPanelProps) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const { progress, sheetHeight, close } = panel
  const scrollY = useSharedValue(0)
  const dragging = useSharedValue(false)
  const nativeScroll = useMemo(() => Gesture.Native(), [])
  // The list sits on the bottom edge as tall as its rows, up to the full screen. It scrolls only
  // when even that is too short; otherwise a scroll of a few spare pixels fights the closing pull.
  const [viewportH, setViewportH] = useState(0)
  const [contentH, setContentH] = useState(0)
  const scrollable = contentH > viewportH + 1
  // A detail screen opened from a row covers home: the list unmounts so its readouts and native
  // series stop, and comes back with the screen.
  const [focused, setFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, []),
  )

  const listShown = panel.mounted && focused

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y
  })

  // Pulled down anywhere — scrim, grabber, or the list once it is at its top — the list follows the
  // finger out.
  const closeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(panel.active)
        .activeOffsetY(10)
        .failOffsetY(-8)
        .failOffsetX([-24, 24])
        .simultaneousWithExternalGesture(nativeScroll)
        .onStart(() => {
          dragging.value = scrollY.value <= 1
        })
        .onUpdate((event) => {
          if (!dragging.value) return
          progress.value = 1 - Math.min(1, Math.max(0, event.translationY) / sheetHeight.value)
        })
        // Finalize, not end: a cancelled drag must settle too, or the list stays half-pulled.
        .onFinalize((event, success) => {
          if (!dragging.value) return
          dragging.value = false
          if (success && settlesAcross(event.translationY, event.velocityY)) {
            close()
          } else {
            progress.value = withSpring(1, SPRING)
          }
        }),
    [close, dragging, nativeScroll, panel.active, progress, scrollY, sheetHeight],
  )

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }))
  // Closed, the list is hidden outright rather than parked: before its first layout there is no
  // height to park it by.
  const contentStyle = useAnimatedStyle(() => ({
    opacity: progress.value > 0 ? 1 : 0,
    transform: [{ translateY: (1 - progress.value) * sheetHeight.value }],
  }))

  return (
    <GestureDetector gesture={closeGesture}>
      <View pointerEvents={panel.active ? 'auto' : 'none'} style={styles.layer}>
        <Animated.View style={[styles.scrim, scrimStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close telemetry"
          />
        </Animated.View>
        <Animated.View
          style={[styles.content, { maxHeight: windowHeight - insets.top }, contentStyle]}
          // Only the list's height counts. Measured without it, the bare grabber would make the
          // first pixels of a drag read as fully open; the last open's height stands in until the
          // list lays out.
          onLayout={(event) => {
            if (listShown) sheetHeight.value = Math.max(1, event.nativeEvent.layout.height)
          }}
          testID="telemetry-panel"
        >
          <View style={styles.grabber} />
          {listShown ? (
            <GestureDetector gesture={nativeScroll}>
              <Animated.ScrollView
                onScroll={onScroll}
                scrollEventThrottle={16}
                style={styles.scroll}
                scrollEnabled={scrollable}
                bounces={false}
                overScrollMode="never"
                onLayout={(event) => setViewportH(event.nativeEvent.layout.height)}
                onContentSizeChange={(_w, h) => setContentH(h)}
                contentContainerStyle={{ paddingBottom: insets.bottom }}
              >
                <LiveTelemetryList headerStart={<LiveTelemetryExport />} />
              </Animated.ScrollView>
            </GestureDetector>
          ) : null}
        </Animated.View>
      </View>
    </GestureDetector>
  )
}
/* eslint-enable react-hooks/immutability */

/** Shares the live window, every frame at full rate, as a CSV. */
function LiveTelemetryExport() {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <IconButton
        icon={ExportIcon}
        loading={exporting}
        accessibilityLabel="Export live telemetry CSV"
        testID="telemetry-panel-export"
        onPress={() => {
          setExporting(true)
          void exportLiveTelemetryCsv()
            .then((file) => shareExportFile(file, 'Export CSV'))
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : 'Could not export live telemetry'),
            )
            .finally(() => setExporting(false))
        }}
      />
      <InfoModal
        visible={error != null}
        title="Export failed"
        message={error ?? ''}
        variant="danger"
        onDismiss={() => setError(null)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  // Above every other layer of the face (the map buttons sit at 41), so all of it dims under the
  // scrim alike and none of it takes touches through it.
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 45,
  },
  // The drawers' flat scrim: everything under the panel, gauges included, recedes behind it.
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
  },
  content: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: theme.alpha(theme.neutral.textSecondary, 0.6),
    marginVertical: 10,
  },
})
