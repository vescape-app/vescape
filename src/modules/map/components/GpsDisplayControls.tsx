import { useHeadingMotionStore } from '@/modules/map/store/headingMotionStore'
import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { PlaygroundSlider } from '@/modules/map/components/PlaygroundSlider'
import { useGpsDisplayStore } from '@/modules/map/store/gpsDisplayStore'

/** Shared settings and playground controls; both drive the same native display algorithm.
 * @parity /modules/vescape-core/ios/location/GpsDisplaySmoother.swift `configure`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsDisplaySmoother.kt `configure`
 */
export function GpsDisplayControls() {
  const arrowSpeed = useHeadingMotionStore((s) => s.arrowSpeedPercent)
  const gpsCameraSpeed = useHeadingMotionStore((s) => s.gpsCameraSpeedPercent)
  const compassCameraSpeed = useHeadingMotionStore((s) => s.compassCameraSpeedPercent)
  const setSpeed = useHeadingMotionStore((s) => s.setSpeed)
  const smoothing = useGpsDisplayStore((s) => s.smoothingPercent)
  const prediction = useGpsDisplayStore((s) => s.predictionPercent)
  const setSmoothing = useGpsDisplayStore((s) => s.setSmoothingPercent)
  const setPrediction = useGpsDisplayStore((s) => s.setPredictionPercent)
  return (
    <View style={styles.controls}>
      <PlaygroundSlider
        label="Smoothing · GPS interval"
        value={smoothing}
        min={0}
        max={200}
        step={1}
        color={theme.palette.violet.color}
        format={(value) => `${value.toFixed(0)}%`}
        onChange={setSmoothing}
      />
      <PlaygroundSlider
        label="Prediction · VESC speed"
        value={prediction}
        min={0}
        max={100}
        step={1}
        color={theme.palette.sky.color}
        format={(value) => `${value.toFixed(0)}%`}
        onChange={setPrediction}
      />
      {(
        [
          ['Arrow rotation speed', 'arrowSpeedPercent', arrowSpeed],
          ['Camera rotation · GPS heading', 'gpsCameraSpeedPercent', gpsCameraSpeed],
          ['Camera rotation · Compass', 'compassCameraSpeedPercent', compassCameraSpeed],
        ] as const
      ).map(([label, key, value]) => (
        <PlaygroundSlider
          key={key}
          label={label}
          value={value}
          min={10}
          max={400}
          step={10}
          color={theme.palette.sky.color}
          format={(percent) => `${percent.toFixed(0)}%`}
          onChange={(percent) => setSpeed(key, percent)}
        />
      ))}
      <Text>Rotation: 100% is the current default speed. Higher values turn faster.</Text>
      <Text>
        100% smoothing corrects GPS over one interval; 0% snaps to each fix. 100% prediction follows
        full VESC speed; 25% follows a quarter. Display only.
      </Text>
    </View>
  )
}
const styles = StyleSheet.create({ controls: { padding: 16, gap: 8 } })
