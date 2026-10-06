import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureDetector, type GestureType } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'

import { BAR_H, BAR_H_COMPACT } from '@/components/charts/LinearGaugeBar'
import { BatteryIndicator } from '@/modules/board/components/BatteryIndicator'
import { RimTempArc } from '@/modules/board/components/RimTempArc'
import { interaction, theme } from '@/constants/theme'
import { telemetry } from '@/modules/board/constants/telemetry'
import { routes } from '@/navigation/routes'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useBleStore } from '@/modules/board/store/bleStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { useFootpadThreshold, usePosiSensor } from '@/modules/board/store/boardConfigValuesStore'
import { BoardAttitudeIndicator } from '@/modules/board/components/BoardAttitudeIndicator'
import { FootpadIndicator } from '@/modules/board/components/FootpadIndicator'
import { useTelemetryPanelFadeStyle } from '@/screens/main/overlays/TelemetryPanel'

/** Temperature arc radius: the arcs run the strip's height down to the battery line. */
const ARC_RADIUS = 72
const ARC_RADIUS_COMPACT = 60
/** Room under the battery line for the pack voltage. */
const AUX_HEIGHT = 16
/** Air between the voltage and the home indicator. */
const STRIP_BOTTOM_PADDING = 10
const STRIP_TOP_PADDING = 4
export const STRIP_CONTENT_HEIGHT =
  STRIP_TOP_PADDING + ARC_RADIUS + AUX_HEIGHT + STRIP_BOTTOM_PADDING
export const STRIP_CONTENT_HEIGHT_COMPACT =
  STRIP_TOP_PADDING + ARC_RADIUS_COMPACT + AUX_HEIGHT + STRIP_BOTTOM_PADDING
const SMALL_SCREEN_HEIGHT = 700
/** The icon row is only the bar's height off the arcs; slop brings the target back to glove size. */
const SIDE_ICON_HIT_SLOP = { top: 12, bottom: 12 }

export function isSmallScreen(height: number): boolean {
  return height < SMALL_SCREEN_HEIGHT
}

export function stripBottomSpacing(insetBottom: number, screenHeight: number): number {
  return Math.max(insetBottom * 0.5, isSmallScreen(screenHeight) ? 4 : 8)
}

export function useAboveStripBottom(): number {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const contentHeight = isSmallScreen(height) ? STRIP_CONTENT_HEIGHT_COMPACT : STRIP_CONTENT_HEIGHT
  return contentHeight + stripBottomSpacing(insets.bottom, height) + 8
}

interface BottomTelemetryStripProps {
  revealProgress?: SharedValue<number>
  /** The telemetry panel this strip opens into: pulled up, the strip fades into it. */
  panelProgress: SharedValue<number>
  panelActive: boolean
  /** Upward drag anywhere on the strip that opens the panel. */
  openGesture: GestureType
  /** Tap on the handle, for riders who would not think to drag. */
  onOpenPanel: () => void
}

export function BottomTelemetryStrip({
  revealProgress,
  panelProgress,
  panelActive,
  openGesture,
  onOpenPanel,
}: BottomTelemetryStripProps) {
  useRenderRateWarning('BottomTelemetryStrip')
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const bleStatus = useBleStore((s) => s.status)
  const imuConnected = bleStatus === 'connected'
  // Live numbers, IMU tilt and the footpad pad read SharedValues (hot path, ~31Hz, no re-render).
  const tick = liveTelemetryRuntime.values

  const revealStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: revealProgress ? 74 * revealProgress.value : 0 }],
  }))
  const panelFadeStyle = useTelemetryPanelFadeStyle(panelProgress)

  const footpad1Threshold = useFootpadThreshold(0)
  const footpad2Threshold = useFootpadThreshold(1)
  const posiSensor = usePosiSensor()
  const compact = isSmallScreen(height)
  const radius = compact ? ARC_RADIUS_COMPACT : ARC_RADIUS
  const barHeight = compact ? BAR_H_COMPACT : BAR_H

  return (
    <Animated.View
      style={[
        styles.wrap,
        { paddingBottom: stripBottomSpacing(insets.bottom, height) },
        panelFadeStyle,
      ]}
      pointerEvents={panelActive ? 'none' : 'box-none'}
    >
      <GestureDetector gesture={openGesture}>
        <Animated.View style={[styles.rim, revealStyle]}>
          <RimTempArc
            side="left"
            label="Motor"
            metric={telemetry.motorTemp}
            value={tick.motorTemp}
            radius={radius}
            onPress={() => router.push(routes.controlMotorTemp)}
            testID="telemetry-motor-temp-cell"
          />
          <View style={styles.center}>
            <View style={[styles.upperRow, { height: radius - barHeight }]}>
              <Pressable
                style={({ pressed }) => [styles.sideIcon, pressed && styles.cellPressed]}
                hitSlop={SIDE_ICON_HIT_SLOP}
                android_ripple={interaction.rippleBorderless}
                onPress={() => router.push(routes.controlImu)}
                accessibilityRole="button"
                accessibilityLabel="Board pitch and roll"
                testID="telemetry-attitude-cell"
              >
                <BoardAttitudeIndicator
                  pitch={tick.pitch}
                  roll={tick.roll}
                  connected={imuConnected}
                  testID="telemetry-attitude-indicator"
                />
              </Pressable>
              {/* Grip for the telemetry panel: the whole strip pulls up into it, or a tap opens it. */}
              <Pressable
                style={({ pressed }) => [styles.handleHit, pressed && styles.cellPressed]}
                hitSlop={SIDE_ICON_HIT_SLOP}
                onPress={onOpenPanel}
                accessibilityRole="button"
                accessibilityLabel="Open live telemetry"
                testID="telemetry-panel-handle"
              >
                <View style={styles.handle} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.sideIcon, pressed && styles.cellPressed]}
                hitSlop={SIDE_ICON_HIT_SLOP}
                android_ripple={interaction.rippleBorderless}
                onPress={() => router.push(routes.controlFootpad)}
              >
                <FootpadIndicator
                  adc1={tick.adc1}
                  adc2={tick.adc2}
                  posi={posiSensor}
                  threshold1={footpad1Threshold}
                  threshold2={footpad2Threshold}
                  testID="telemetry-footpad-indicator"
                />
              </Pressable>
            </View>
            <BatteryIndicator transparent compact={compact} containerStyle={styles.battery} />
          </View>
          <RimTempArc
            side="right"
            label="Ctrl"
            metric={telemetry.controllerTemp}
            value={tick.controllerTemp}
            radius={radius}
            onPress={() => router.push(routes.controlControllerTemp)}
            testID="telemetry-controller-temp-cell"
          />
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  rim: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: STRIP_TOP_PADDING,
    paddingBottom: STRIP_BOTTOM_PADDING,
    paddingHorizontal: 12,
  },
  center: {
    flex: 1,
    // Keeps the battery line apart from the temperature arcs either side of it.
    marginHorizontal: 8,
  },
  upperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  battery: {
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
    marginHorizontal: 0,
    marginBottom: 0,
  },
  // Wider than the bar so a thumb finds it; the side icons keep their own width either side.
  handleHit: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.palette.slate.border,
  },
  sideIcon: {
    width: 56,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellPressed: {
    opacity: interaction.pressedOpacity,
  },
})
