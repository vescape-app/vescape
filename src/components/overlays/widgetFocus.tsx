import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { WidgetHeader, type WidgetHeaderProps } from '@/components/widgets/widgetHeader'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'

const OPEN_DURATION = 240
const CLOSE_DURATION = 160
const VIEWPORT_MARGIN = 16
const PANEL_SCALE_FROM = 0.96
const DISMISS_DISTANCE = 90
const DISMISS_VELOCITY = 800
const UPWARD_DRAG_RESISTANCE = 0.25

interface FocusRect {
  x: number
  y: number
  width: number
  height: number
}

interface FocusRequest {
  rect: FocusRect
  header: WidgetHeaderProps
  Body: React.ComponentType
}

interface WidgetFocusController {
  open: (
    ref: React.RefObject<View | null>,
    header: WidgetHeaderProps,
    Body: React.ComponentType,
  ) => void
  close: () => void
}

const WidgetFocusContext = createContext<WidgetFocusController | null>(null)

export function useWidgetFocus() {
  const controller = useContext(WidgetFocusContext)
  if (!controller) throw new Error('useWidgetFocus requires a widget focus host')
  return controller
}

export interface WidgetFocusHost {
  rootRef: React.RefObject<View | null>
  controller: WidgetFocusController
  active: boolean
  request: FocusRequest | null
  closing: boolean
  finish: () => void
}

export function useWidgetFocusHost(): WidgetFocusHost {
  const rootRef = useRef<View>(null)
  const [request, setRequest] = useState<FocusRequest | null>(null)
  const [closing, setClosing] = useState(false)

  const open = useCallback<WidgetFocusController['open']>((ref, header, Body) => {
    const root = rootRef.current
    const widget = ref.current
    if (!root || !widget) return
    widget.measureLayout(root, (x, y, width, height) => {
      setClosing(false)
      setRequest({ rect: { x, y, width, height }, header, Body })
    })
  }, [])

  const close = useCallback(() => setClosing(true), [])

  const finish = useCallback(() => {
    setClosing(false)
    setRequest(null)
  }, [])

  const controller = useMemo<WidgetFocusController>(() => ({ open, close }), [close, open])

  return { rootRef, controller, active: request != null, request, closing, finish }
}

export function WidgetFocusProvider({
  host,
  children,
}: {
  host: WidgetFocusHost
  children: React.ReactNode
}) {
  return (
    <WidgetFocusContext.Provider value={host.controller}>{children}</WidgetFocusContext.Provider>
  )
}

/* eslint-disable react-hooks/immutability */
export function WidgetFocusOverlay({ host }: { host: WidgetFocusHost }) {
  const { request, closing, finish } = host
  const { height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const progress = useSharedValue(0)
  const drag = useSharedValue(0)
  const [panelHeight, setPanelHeight] = useState(0)

  const measurePanel = useCallback((event: LayoutChangeEvent) => {
    setPanelHeight(event.nativeEvent.layout.height)
  }, [])

  const rect = request?.rect
  const maxHeight = windowHeight - insets.top - insets.bottom - VIEWPORT_MARGIN * 2
  const top = rect
    ? Math.max(
        insets.top + VIEWPORT_MARGIN,
        Math.min(
          rect.y + rect.height / 2 - panelHeight / 2,
          windowHeight - insets.bottom - VIEWPORT_MARGIN - panelHeight,
        ),
      )
    : 0
  const travel = rect ? rect.y - top : 0

  useEffect(() => {
    if (!request) {
      progress.value = 0
      drag.value = 0
      setPanelHeight(0)
      return
    }
    if (closing) {
      progress.value = withTiming(
        0,
        { duration: CLOSE_DURATION, easing: Easing.in(Easing.quad) },
        (done) => {
          if (done) scheduleOnRN(finish)
        },
      )
      return
    }
    if (panelHeight > 0) {
      progress.value = withTiming(1, { duration: OPEN_DURATION, easing: Easing.out(Easing.cubic) })
    }
  }, [closing, drag, finish, panelHeight, progress, request])

  const close = host.controller.close
  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((event) => {
          drag.value =
            event.translationY >= 0
              ? event.translationY
              : event.translationY * UPWARD_DRAG_RESISTANCE
        })
        .onEnd((event) => {
          if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
            drag.value = withTiming(drag.value + event.velocityY * 0.1, {
              duration: CLOSE_DURATION,
            })
            scheduleOnRN(close)
            return
          }
          drag.value = withSpring(0, { damping: 30, stiffness: 220 })
        }),
    [close, drag],
  )

  const scrimGesture = useMemo(
    () =>
      Gesture.Race(
        dragGesture,
        Gesture.Tap().onEnd((_event, success) => {
          if (success) scheduleOnRN(close)
        }),
      ),
    [close, dragGesture],
  )

  const surface = useResolvedSecondaryWidgetSurface()

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value * (1 - Math.min(1, Math.max(0, drag.value) / DISMISS_DISTANCE) * 0.5),
  }))
  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * travel + drag.value },
      { scale: PANEL_SCALE_FROM + (1 - PANEL_SCALE_FROM) * progress.value },
    ],
  }))

  if (!request) return null

  const { Body, header } = request

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <GestureDetector gesture={scrimGesture}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}
          accessibilityRole="button"
          accessibilityLabel={`Close ${header.title}`}
        />
      </GestureDetector>
      <Animated.View
        onLayout={measurePanel}
        style={[
          surface,
          styles.panel,
          { top, left: request.rect.x, width: request.rect.width, maxHeight },
          panelStyle,
        ]}
      >
        <GestureDetector gesture={dragGesture}>
          <View>
            <View style={styles.grabber} />
            <WidgetHeader {...header} />
          </View>
        </GestureDetector>
        <View style={styles.body}>
          <Body />
        </View>
      </Animated.View>
    </View>
  )
}
/* eslint-enable react-hooks/immutability */

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.8),
  },
  panel: {
    position: 'absolute',
    padding: 14,
  },
  body: {
    gap: 8,
    paddingTop: 8,
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    marginBottom: 10,
    borderRadius: 999,
    backgroundColor: theme.alpha(theme.neutral.textSecondary, 0.6),
  },
})
