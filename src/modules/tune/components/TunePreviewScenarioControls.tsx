import { useFormat } from '@/hooks/useFormat'
/* eslint-disable react-hooks/immutability */
import { useCallback, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { MountainsIcon, WaveSineIcon } from 'phosphor-react-native'
import {
  Easing,
  cancelAnimation,
  useAnimatedReaction,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { useUnitSystem } from '@/hooks/useUnitSystem'
import {
  lengthFromMeters,
  lengthInputToMeters,
  lengthUnit,
  speedFromKmh,
  speedInputToKmh,
  speedUnit,
} from '@/helpers/units'
import {
  HILLS_PRESETS,
  MOVEMENT_RANGES,
  type HillsPresetId,
  type MovementPresetId,
} from '@/modules/tune/lib/tunePreviewPresentation'
import { useTunePreviewFormat } from '@/modules/tune/hooks/useTunePreviewFormat'
export type { HillsPresetId } from '@/modules/tune/lib/tunePreviewPresentation'
import { SelectCard } from '@/components/forms/SelectCard'
import { PitchInputControl } from '@/modules/tune/components/PitchInputControl'
import { TuneDial } from '@/modules/tune/components/TuneDial'
import { theme } from '@/constants/theme'
import {
  MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND,
  pitchInputRateToControlDegrees,
} from '@/modules/tune/lib/tunePreview'

type MovementDirection = 'nose' | 'tail'

const RAPID_MOVEMENT_RATE_DEGREES_PER_SECOND = 125
const SLOW_MOVEMENT_RATE_DEGREES_PER_SECOND = 128
const FRONT_BACK_MOVEMENT_RATE_DEGREES_PER_SECOND = 125
const MOVEMENT_BOARD_FULL_POWER_GROUND_ANGLE_DEGREES = 7.5
const MOVEMENT_BOARD_MAX_GROUND_ANGLE_DEGREES = 15
const AUTO_MOVEMENT_SMOOTH_MS = 1400
const AUTO_MOVEMENT_RELEASE_MS = 700

interface TunePreviewScenarioControlsProps {
  hillsPreset: HillsPresetId
  onHillsPresetChange: (preset: HillsPresetId) => void
  hillHeightMeters: number
  onHillHeightChange: (value: number) => void
  hillSpacingMeters: number
  onHillSpacingChange: (value: number) => void
  pitchInputDegrees: SharedValue<number>
  pitchInputActive: SharedValue<boolean>
  speedKmh: SharedValue<number>
  groundToBoardAngleDegrees: SharedValue<number>
}

export function TunePreviewScenarioControls({
  hillsPreset,
  onHillsPresetChange,
  hillHeightMeters,
  onHillHeightChange,
  hillSpacingMeters,
  onHillSpacingChange,
  pitchInputDegrees,
  pitchInputActive,
  speedKmh,
  groundToBoardAngleDegrees,
}: TunePreviewScenarioControlsProps) {
  const units = useUnitSystem()
  const { formatSpeedWithUnit } = useFormat()
  const { options, formatHillHeight, formatHillSpacing } = useTunePreviewFormat()
  const [movementPreset, setMovementPreset] = useState<MovementPresetId>('manual')
  const [customLowSpeedKmh, setCustomLowSpeedKmh] = useState(10)
  const [customHighSpeedKmh, setCustomHighSpeedKmh] = useState(25)
  const [customRateDegreesPerSecond, setCustomRateDegreesPerSecond] = useState(100)
  const movementDirectionRef = useRef<MovementDirection>('nose')
  const movementPresetRef = useRef<MovementPresetId>('manual')

  const handlePresetChange = (preset: HillsPresetId) => {
    onHillsPresetChange(preset)
    if (preset !== 'custom' && preset !== 'flat') {
      const values = HILLS_PRESETS[preset]
      if (values) {
        onHillHeightChange(values.heightMeters)
        onHillSpacingChange(values.spacingMeters)
      }
    }
  }

  const applyMovementSample = useCallback(
    (speed: number, groundAngleDegrees: number) => {
      const activeMovementPreset = movementPresetRef.current
      if (activeMovementPreset === 'manual') return

      const groundAngleMagnitude = Math.abs(groundAngleDegrees)
      if (groundAngleMagnitude >= MOVEMENT_BOARD_MAX_GROUND_ANGLE_DEGREES) {
        pitchInputActive.value = true
        pitchInputDegrees.value = withTiming(0, {
          duration: AUTO_MOVEMENT_RELEASE_MS,
          easing: Easing.out(Easing.cubic),
        })
        return
      }

      const range =
        activeMovementPreset === 'custom'
          ? { lowKmh: customLowSpeedKmh, highKmh: customHighSpeedKmh }
          : MOVEMENT_RANGES[activeMovementPreset]
      const lowSpeed = range.lowKmh
      const highSpeed = range.highKmh
      const rate =
        activeMovementPreset === 'rapid'
          ? RAPID_MOVEMENT_RATE_DEGREES_PER_SECOND
          : activeMovementPreset === 'slow'
            ? SLOW_MOVEMENT_RATE_DEGREES_PER_SECOND
            : activeMovementPreset === 'frontBack'
              ? FRONT_BACK_MOVEMENT_RATE_DEGREES_PER_SECOND
              : customRateDegreesPerSecond

      const lowerBound = Math.min(lowSpeed, highSpeed)
      const upperBound = Math.max(lowSpeed, highSpeed)

      if (speed <= lowerBound) movementDirectionRef.current = 'nose'
      if (speed >= upperBound) movementDirectionRef.current = 'tail'

      const rateScale =
        groundAngleMagnitude <= MOVEMENT_BOARD_FULL_POWER_GROUND_ANGLE_DEGREES
          ? 1
          : (MOVEMENT_BOARD_MAX_GROUND_ANGLE_DEGREES - groundAngleMagnitude) /
            (MOVEMENT_BOARD_MAX_GROUND_ANGLE_DEGREES -
              MOVEMENT_BOARD_FULL_POWER_GROUND_ANGLE_DEGREES)
      const scaledRate = rate * rateScale
      const signedRate = movementDirectionRef.current === 'nose' ? -scaledRate : scaledRate
      pitchInputActive.value = true
      pitchInputDegrees.value = withTiming(pitchInputRateToControlDegrees(signedRate), {
        duration: AUTO_MOVEMENT_SMOOTH_MS,
        easing: Easing.out(Easing.cubic),
      })
    },
    [
      customHighSpeedKmh,
      customLowSpeedKmh,
      customRateDegreesPerSecond,
      pitchInputActive,
      pitchInputDegrees,
    ],
  )

  const handleMovementPresetChange = (preset: MovementPresetId) => {
    movementPresetRef.current = preset
    setMovementPreset(preset)
    movementDirectionRef.current = 'nose'
    if (preset === 'manual') {
      cancelAnimation(pitchInputDegrees)
      pitchInputActive.value = false
      pitchInputDegrees.value = 0
    }
  }

  useAnimatedReaction(
    () => ({
      speed: speedKmh.value,
      groundAngleDegrees: groundToBoardAngleDegrees.value,
    }),
    (next, previous) => {
      if (
        next.speed !== previous?.speed ||
        next.groundAngleDegrees !== previous?.groundAngleDegrees
      ) {
        scheduleOnRN(applyMovementSample, next.speed, next.groundAngleDegrees)
      }
    },
    [applyMovementSample],
  )

  return (
    <View style={styles.stack}>
      <SelectCard
        icon={WaveSineIcon}
        iconColor={theme.palette.cyan.color}
        title="Balance Input"
        description="Simulates rider lean"
        options={options.movement}
        value={movementPreset}
        onChange={handleMovementPresetChange}
      >
        {movementPreset === 'custom' ? (
          <>
            <Text style={styles.description}>
              Low speed · {formatSpeedWithUnit(customLowSpeedKmh, 1)}
            </Text>
            <TuneDial
              key={`low-${units}`}
              value={speedFromKmh(customLowSpeedKmh, units)}
              min={speedFromKmh(-30, units)}
              max={speedFromKmh(45, units)}
              step={1}
              displayDecimals={1}
              unit={speedUnit(units)}
              valueChangeMode="live"
              onValueChange={(value) =>
                setCustomLowSpeedKmh(speedInputToKmh(value, customLowSpeedKmh, units, -30, 45))
              }
            />
            <Text style={styles.description}>
              High speed · {formatSpeedWithUnit(customHighSpeedKmh, 1)}
            </Text>
            <TuneDial
              key={`high-${units}`}
              value={speedFromKmh(customHighSpeedKmh, units)}
              min={speedFromKmh(-15, units)}
              max={speedFromKmh(50, units)}
              step={1}
              displayDecimals={1}
              unit={speedUnit(units)}
              valueChangeMode="live"
              onValueChange={(value) =>
                setCustomHighSpeedKmh(speedInputToKmh(value, customHighSpeedKmh, units, -15, 50))
              }
            />
            <Text style={styles.description}>
              Pitch rate · ±{customRateDegreesPerSecond.toFixed(0)}°/s
            </Text>
            <TuneDial
              value={customRateDegreesPerSecond}
              min={10}
              max={MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND}
              step={1}
              unit="°/s"
              valueChangeMode="live"
              onValueChange={setCustomRateDegreesPerSecond}
            />
          </>
        ) : null}
        {movementPreset === 'manual' ? (
          <PitchInputControl angleDegrees={pitchInputDegrees} active={pitchInputActive} />
        ) : null}
      </SelectCard>

      <SelectCard
        icon={MountainsIcon}
        iconColor={theme.palette.green.color}
        title="Terrain"
        description="Simulates the slope"
        options={options.hills}
        value={hillsPreset}
        onChange={handlePresetChange}
      >
        {hillsPreset === 'custom' ? (
          <>
            <Text style={styles.description}>
              Valley-to-peak height · {formatHillHeight(hillHeightMeters)}
            </Text>
            <TuneDial
              key={`height-${units}`}
              value={lengthFromMeters(hillHeightMeters, units)}
              min={lengthFromMeters(0, units)}
              max={lengthFromMeters(50, units)}
              step={0.1}
              displayDecimals={1}
              unit={lengthUnit(units)}
              valueChangeMode="live"
              onValueChange={(value) =>
                onHillHeightChange(lengthInputToMeters(value, hillHeightMeters, units, 0, 50))
              }
            />
            <Text style={styles.description}>
              Peak-to-peak distance · {formatHillSpacing(hillSpacingMeters)}
            </Text>
            <TuneDial
              key={`spacing-${units}`}
              value={lengthFromMeters(hillSpacingMeters, units)}
              min={lengthFromMeters(2, units)}
              max={lengthFromMeters(1000, units)}
              step={1}
              displayDecimals={1}
              unit={lengthUnit(units)}
              valueChangeMode="live"
              onValueChange={(value) =>
                onHillSpacingChange(lengthInputToMeters(value, hillSpacingMeters, units, 2, 1000))
              }
            />
          </>
        ) : null}
      </SelectCard>
    </View>
  )
}

const styles = StyleSheet.create({
  stack: {
    gap: 8,
  },
  description: { color: theme.neutral.textSecondary, fontSize: 10, fontWeight: '600' },
})
