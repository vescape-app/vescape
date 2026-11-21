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

const SETTLE_DISTANCE = 64
const SETTLE_VELOCITY = 500
const FADE_END = 0.2
const FADE_LIFT = 24
const SPRING = { damping: 20, stiffness: 180, mass: 0.8, overshootClamping: true } as const

export interface TelemetryPanelState {
  progress: SharedValue<number>
  sheetHeight: SharedValue<number>
  active: boolean
  mounted: boolean
  openGesture: GestureType
  close: () => void
  open: () => void
}

function settlesAcross(travel: number, velocity: number) {
  'worklet'
  if (velocity > SETTLE_VELOCITY) return true
  if (velocity < -SETTLE_VELOCITY) return false
  return travel > SETTLE_DISTANCE
}

/* eslint-disable react-hooks/immutability */
export function useTelemetryPanel(enabled: boolean): TelemetryPanelState {
  const progress = useSharedValue(0)
  const { height: windowHeight } = useWindowDimensions()
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

  useEffect(() => {
    if (enabled) return
    progress.value = 0
    settleClosed()
  }, [enabled, progress, settleClosed])

  return { progress, sheetHeight, active: open, mounted, openGesture, close, open: openPanel }
}
/* eslint-enable react-hooks/immutability */

export function useTelemetryPanelFadeStyle(progress: SharedValue<number>) {
  return useAnimatedStyle(() => {
    const t = interpolate(progress.value, [0, FADE_END], [0, 1], Extrapolation.CLAMP)
    return { opacity: 1 - t, transform: [{ translateY: -FADE_LIFT * t }] }
  })
}

interface TelemetryPanelProps {
  panel: TelemetryPanelState
}

/* eslint-disable react-hooks/immutability */
export function TelemetryPanel({ panel }: TelemetryPanelProps) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const { progress, sheetHeight, close } = panel
  const scrollY = useSharedValue(0)
  const dragging = useSharedValue(false)
  const nativeScroll = useMemo(() => Gesture.Native(), [])
  const [viewportH, setViewportH] = useState(0)
  const [contentH, setContentH] = useState(0)
  const scrollable = contentH > viewportH + 1
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
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 45,
  },
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
