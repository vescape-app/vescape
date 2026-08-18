import { Pressable, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'

import { BatteryIndicator } from '@/modules/board/components/BatteryIndicator'
import { TelemetryCell } from '@/modules/board/components/TelemetryCell'
import { interaction, theme } from '@/constants/theme'
import { telemetry } from '@/modules/board/constants/telemetry'
import { routes } from '@/navigation/routes'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useBleStore } from '@/modules/board/store/bleStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'

const FOOTPAD_ACTIVE_V = 0.8
export const STRIP_CONTENT_HEIGHT = 160

interface BottomTelemetryStripProps {
  revealProgress?: SharedValue<number>
}

export function BottomTelemetryStrip({ revealProgress }: BottomTelemetryStripProps) {
  useRenderRateWarning('BottomTelemetryStrip')
  const insets = useSafeAreaInsets()
  const bleStatus = useBleStore((s) => s.status)
  const imuConnected = bleStatus === 'connected'
  // Live numbers, IMU tilt and footpad dots read SharedValues (hot path, ~31Hz, no re-render).
  const tick = liveTelemetryRuntime.values

  const revealStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: revealProgress ? 74 * revealProgress.value : 0 }],
  }))
  const imuLineStyle = useAnimatedStyle(() => {
    const p = tick.pitch.value ?? 0
    return { transform: [{ rotate: `${imuConnected ? p : 0}deg` }] }
  })

  const footpad1Style = useAnimatedStyle(() => {
    const a = tick.adc1.value
    const active = a != null && a > FOOTPAD_ACTIVE_V
    return {
      borderColor: active ? theme.palette.green.text : theme.palette.slate.textDim,
      backgroundColor: active ? theme.palette.green.text : 'transparent',
    }
  })

  const footpad2Style = useAnimatedStyle(() => {
    const a = tick.adc2.value
    const active = a != null && a > FOOTPAD_ACTIVE_V
    return {
      borderColor: active ? theme.palette.green.text : theme.palette.slate.textDim,
      backgroundColor: active ? theme.palette.green.text : 'transparent',
    }
  })

  return (
    <Animated.View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom * 0.5, 8) }]}
      pointerEvents="box-none"
    >
      <Animated.View style={revealStyle}>
        <View style={styles.strip}>
          <TelemetryCell
            label="Motor"
            metric={telemetry.motorTemp}
            value={tick.motorTemp}
            metricKey="motorTemp"
            onPress={() => router.push(routes.controlMotorTemp)}
            testID="telemetry-motor-temp-cell"
          />
          <TelemetryCell
            label="Ctrl"
            metric={telemetry.controllerTemp}
            value={tick.controllerTemp}
            metricKey="controllerTemp"
            onPress={() => router.push(routes.controlControllerTemp)}
            testID="telemetry-controller-temp-cell"
          />
          <TelemetryCell
            label="Motor"
            metric={telemetry.motorCurrent}
            value={tick.motorCurrent}
            metricKey="motorCurrent"
            onPress={() => router.push(routes.controlMotorCurrent)}
            testID="telemetry-motor-current-cell"
          />
          <TelemetryCell
            label="Batt"
            metric={telemetry.battCurrent}
            value={tick.batteryCurrent}
            metricKey="batteryCurrent"
            onPress={() => router.push(routes.controlBatteryCurrent)}
            testID="telemetry-battery-current-cell"
          />
        </View>

        <View style={styles.bottomRow}>
          <Pressable
            style={({ pressed }) => [styles.sideIcon, pressed && styles.cellPressed]}
            android_ripple={interaction.rippleBorderless}
            onPress={() => router.push(routes.controlImu)}
          >
            <View
              style={[
                styles.imuMarker,
                {
                  borderColor: imuConnected
                    ? theme.palette.purple.color
                    : theme.palette.slate.textMuted,
                },
              ]}
            />
            <Animated.View
              style={[
                styles.imuLine,
                {
                  backgroundColor: imuConnected
                    ? theme.palette.purple.color
                    : theme.palette.slate.textMuted,
                },
                imuLineStyle,
              ]}
            />
          </Pressable>
          <BatteryIndicator transparent containerStyle={styles.batteryCenter} />
          <Pressable
            style={({ pressed }) => [styles.sideIcon, pressed && styles.cellPressed]}
            android_ripple={interaction.rippleBorderless}
            onPress={() => router.push(routes.controlFootpad)}
          >
            <View style={styles.footpadRow}>
              <Animated.View style={[styles.footpadDot, footpad1Style]} />
              <Animated.View style={[styles.footpadDot, footpad2Style]} />
            </View>
          </Pressable>
        </View>
      </Animated.View>
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
  strip: {
    flexDirection: 'row',
    paddingTop: 6,
    paddingBottom: 2,
    paddingHorizontal: 20,
    gap: 8,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  sideIcon: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  batteryCenter: {
    flex: 1,
    marginHorizontal: 4,
  },
  footpadRow: {
    flexDirection: 'row',
    gap: 6,
  },
  footpadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: theme.palette.slate.textDim,
    backgroundColor: 'transparent',
  },
  cellPressed: {
    opacity: interaction.pressedOpacity,
  },
  imuLine: {
    width: 32,
    height: 1,
    borderRadius: 1,
    backgroundColor: theme.palette.purple.color,
  },
  imuMarker: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.palette.purple.color,
    backgroundColor: 'transparent',
  },
})
