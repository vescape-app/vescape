import type { MotionDiagnostics } from '@/modules/map/lib/liveMotion/motion'
import { View } from 'react-native'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { PlaygroundSlider } from '@/modules/map/components/PlaygroundSlider'
import { motionControls, type MotionConfig } from '@/modules/map/lib/liveMotion/config'
import { useLiveMotionSettings } from '@/modules/map/store/liveMotionSettings'
import { useNavigationDiagnosticsStore } from '@/modules/map/store/navigationDiagnosticsStore'

/** Developer-only live tuning, shared with the isolated camera bench. */
export function LiveMotionControls({
  evidence: suppliedEvidence,
}: { evidence?: MotionDiagnostics | null } = {}) {
  const { config, set, reset } = useLiveMotionSettings()
  const liveEvidence = useNavigationDiagnosticsStore((state) => state.motion)
  const evidence = suppliedEvidence === undefined ? liveEvidence : suppliedEvidence
  return (
    <View style={{ gap: 12, padding: 14 }}>
      <Text>GPS display motion · session only</Text>
      <Text>GPS cadence sets correction duration automatically.</Text>
      {evidence && (
        <Text selectable>
          {[
            `Measured: ${evidence.measured?.longitude.toFixed(6)}, ${evidence.measured?.latitude.toFixed(6)}`,
            `Displayed: ${evidence.displayed?.map((value) => value.toFixed(6)).join(', ')}`,
            `Cadence: ${evidence.cadenceMs.toFixed(0)} ms`,
            `Confidence: ${(evidence.confidence * 100).toFixed(0)}% · effective prediction: ${(evidence.effectivePrediction * 100).toFixed(0)}%`,
            `Direction age: ${evidence.directionAgeMs?.toFixed(0) ?? 'unknown'} ms`,
            `State: ${evidence.reason}`,
          ].join('\n')}
        </Text>
      )}
      {(Object.keys(motionControls) as (keyof MotionConfig)[]).map((key) => (
        <PlaygroundSlider
          key={key}
          label={key.replace(/([A-Z])/g, ' $1')}
          {...motionControls[key]}
          value={config[key]}
          format={(value) => `${value.toFixed(2)} ${motionControls[key].unit}`}
          onChange={(value) => set(key, value)}
        />
      ))}
      <Button label="Reset motion defaults" variant="secondary" onPress={reset} />
    </View>
  )
}
