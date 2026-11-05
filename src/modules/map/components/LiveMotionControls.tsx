import { acquireLiveDisplay } from '@/modules/map/lib/liveMotion/liveDisplay'
import type { MotionDiagnostics } from 'vescape-core'
import { useEffect } from 'react'
import { useScreenVisible } from '@/hooks/useScreenVisible'
import { ToggleRow } from '@/components/dev/ShowcaseControls'
import { distanceMeters } from '@/helpers/mapGeometry'
import { View } from 'react-native'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { PlaygroundSlider } from '@/modules/map/components/PlaygroundSlider'
import { motionControls, type MotionConfig } from '@/modules/map/lib/liveMotion/config'
import { useLiveMotionSettings } from '@/modules/map/store/liveMotionSettings'
import { useNavigationDiagnosticsStore } from '@/modules/map/store/navigationDiagnosticsStore'

const descriptions: Record<keyof MotionConfig, { label: string; description: string }> = {
  predictionStrength: {
    label: 'Prediction strength',
    description:
      'How strongly Board speed advances the point between GPS fixes. Higher feels more immediate but can increase overshoot. Zero disables prediction, not GPS smoothing.',
  },
  maxPredictionM: {
    label: 'Maximum prediction distance',
    description:
      'Maximum predicted travel after a fix. Lower limits divergence; higher allows more lead.',
  },
  movementM: {
    label: 'Minimum direction movement',
    description:
      'Minimum GPS displacement used as direction evidence, also limited by accuracy. Lower reacts sooner; higher rejects more jitter.',
  },
  cameraConfirmM: {
    label: 'Camera turn confirmation distance',
    description:
      'Distance evidence needed for an ordinary camera turn. Lower reacts sooner; higher holds direction longer. Reversals retain their separate safeguards.',
  },
  cameraPositionOmega: {
    label: 'Camera position response',
    description:
      'How quickly the camera catches the displayed point. Lower gives more lag; higher follows more tightly.',
  },
  cameraHeadingOmega: {
    label: 'Camera rotation response',
    description:
      'How quickly the camera rotates toward a confirmed heading. Lower turns more gently; higher turns faster.',
  },
  arrowHeadingOmega: {
    label: 'Arrow rotation response',
    description:
      'How quickly the travel arrow rotates toward its direction target. Lower is softer; higher is more responsive.',
  },
}
const format = (key: keyof MotionConfig, value: number) =>
  key === 'predictionStrength'
    ? `${(value * 100).toFixed(0)}%`
    : `${value.toFixed(1)} ${motionControls[key].unit}`

/** Developer-only live tuning, shared with the isolated camera bench. */
export function LiveMotionControls({
  evidence: suppliedEvidence,
}: { evidence?: MotionDiagnostics | null } = {}) {
  const { config, set, reset, showSmoothedTrail, showRawGpsPoint, setOverlay } =
    useLiveMotionSettings()
  const visible = useScreenVisible()
  useEffect(() => {
    if (!visible || suppliedEvidence !== undefined) return
    useNavigationDiagnosticsStore.setState((state) => ({
      motionConsumers: state.motionConsumers + 1,
    }))
    const release = acquireLiveDisplay(true)
    return () => {
      release()
      useNavigationDiagnosticsStore.setState((state) => ({
        motionConsumers: state.motionConsumers - 1,
      }))
    }
  }, [visible, suppliedEvidence])
  const liveEvidence = useNavigationDiagnosticsStore((state) => state.motion)
  const evidence = suppliedEvidence === undefined ? liveEvidence : suppliedEvidence
  const measured = evidence?.raw?.coordinate
    ? { longitude: evidence.raw.coordinate[0], latitude: evidence.raw.coordinate[1] }
    : evidence?.measured
  return (
    <View style={{ gap: 12, padding: 14 }}>
      <Text>GPS display motion · session only</Text>
      <Text>GPS cadence sets correction duration automatically.</Text>
      {evidence && (
        <Text selectable>
          {[
            `Measured: ${measured?.longitude.toFixed(6)}, ${measured?.latitude.toFixed(6)}`,
            `Displayed: ${evidence.displayed?.map((value) => value.toFixed(6)).join(', ')}`,
            `Cadence: ${evidence.cadenceMs.toFixed(0)} ms`,
            `Confidence: ${(evidence.confidence * 100).toFixed(0)}% · effective prediction: ${(evidence.effectivePrediction * 100).toFixed(0)}%`,
            `Direction age: ${evidence.directionAgeMs?.toFixed(0) ?? 'unknown'} ms`,
            `State: ${evidence.reason}`,
            `Raw quality: ${evidence.raw ? `${evidence.raw.accepted ? 'accepted' : 'rejected'} · ${evidence.raw.accuracyM == null ? 'unknown accuracy' : `${evidence.raw.accuracyM.toFixed(1)} m accuracy`} · ${evidence.raw.stale ? 'stale' : 'fresh'}` : 'unavailable'}`,
          ].join('\n')}
        </Text>
      )}
      {(Object.keys(motionControls) as (keyof MotionConfig)[]).map((key) => (
        <View key={key} style={{ gap: 4 }}>
          <PlaygroundSlider
            label={descriptions[key].label}
            {...motionControls[key]}
            value={config[key]}
            format={(value) => format(key, value)}
            onChange={(value) => set(key, value)}
          />
          <Text>
            {descriptions[key].description} Default: {format(key, motionControls[key].value)}.
          </Text>
        </View>
      ))}
      <ToggleRow
        label="Show smoothed trail"
        value={showSmoothedTrail}
        onToggle={(value) => setOverlay('showSmoothedTrail', value)}
      />
      <ToggleRow
        label="Show raw GPS point"
        value={showRawGpsPoint}
        onToggle={(value) => setOverlay('showRawGpsPoint', value)}
      />
      <Text>
        White trail: displayed motion. Ring: measured GPS, amber when rejected or accuracy unknown.
        Faded ring: stale data. Raw does not guarantee precision.
      </Text>
      {measured && evidence?.displayed && (
        <Text>
          Measured to displayed:{' '}
          {distanceMeters(measured, {
            longitude: evidence.displayed[0],
            latitude: evidence.displayed[1],
          }).toFixed(1)}{' '}
          m
        </Text>
      )}
      <Button label="Reset motion defaults" variant="secondary" onPress={reset} />
    </View>
  )
}
