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

import type { SelectOption } from '@/components/forms/Select'
import { SelectCard } from '@/components/forms/SelectCard'
import { PitchInputControl } from '@/modules/tune/components/PitchInputControl'
import { TuneDial } from '@/modules/tune/components/TuneDial'
import { theme } from '@/constants/theme'
import {
  MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND,
  pitchInputRateToControlDegrees,
} from '@/modules/tune/lib/tunePreview'

export type HillsPresetId = 'flat' | 'large' | 'small' | 'pumptrack' | 'custom'

const HILLS_PRESETS: Record<
  Exclude<HillsPresetId, 'custom'>,
  { label: string; heightMeters: number; spacingMeters: number }
> = {
  flat: { label: 'Flat road', heightMeters: 0, spacingMeters: 0 },
  large: { label: 'Large hills · 8 m · 90 m', heightMeters: 8, spacingMeters: 90 },
  small: { label: 'Small hills · 2 m · 24 m', heightMeters: 2, spacingMeters: 24 },
  pumptrack: { label: 'Pumptrack · 0.5 m · 5 m', heightMeters: 0.5, spacingMeters: 5 },
}

const HILLS_OPTIONS: SelectOption<HillsPresetId>[] = [
  ...Object.entries(HILLS_PRESETS).map(([value, preset]) => ({
    value: value as HillsPresetId,
    label: preset.label,
  })),
  { value: 'custom', label: 'Enter your own' },
]

type MovementPresetId = 'manual' | 'slow' | 'rapid' | 'frontBack' | 'custom'
type MovementDirection = 'nose' | 'tail'

const RAPID_MOVEMENT_RATE_DEGREES_PER_SECOND = 125
const SLOW_MOVEMENT_RATE_DEGREES_PER_SECOND = 128
const FRONT_BACK_MOVEMENT_RATE_DEGREES_PER_SECOND = 125
const FORWARD_MOVEMENT_LOW_SPEED_KMH = 15
const FORWARD_MOVEMENT_HIGH_SPEED_KMH = 30
const MOVEMENT_BOARD_FULL_POWER_GROUND_ANGLE_DEGREES = 7.5
const MOVEMENT_BOARD_MAX_GROUND_ANGLE_DEGREES = 15
const AUTO_MOVEMENT_SMOOTH_MS = 1400
const AUTO_MOVEMENT_RELEASE_MS = 700

const MOVEMENT_OPTIONS: SelectOption<MovementPresetId>[] = [
  { value: 'manual', label: 'Manual pitch slider' },
  { value: 'slow', label: 'Wide speed range · 5-35 km/h' },
  { value: 'rapid', label: 'Quick speed range · 15-30 km/h' },
  { value: 'frontBack', label: 'Forward/back range · -10-10 km/h' },
  { value: 'custom', label: 'Custom range' },
]

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

      const lowSpeed =
        activeMovementPreset === 'frontBack'
          ? -10
          : activeMovementPreset === 'rapid'
            ? FORWARD_MOVEMENT_LOW_SPEED_KMH
            : activeMovementPreset === 'slow'
              ? 5
              : customLowSpeedKmh
      const highSpeed =
        activeMovementPreset === 'frontBack'
          ? 10
          : activeMovementPreset === 'rapid'
            ? FORWARD_MOVEMENT_HIGH_SPEED_KMH
            : activeMovementPreset === 'slow'
              ? 35
              : customHighSpeedKmh
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
        options={MOVEMENT_OPTIONS}
        value={movementPreset}
        onChange={handleMovementPresetChange}
      >
        {movementPreset === 'custom' ? (
          <>
            <Text style={styles.description}>Low speed · {customLowSpeedKmh.toFixed(0)} km/h</Text>
            <TuneDial
              value={customLowSpeedKmh}
              min={-30}
              max={45}
              step={1}
              unit="km/h"
              valueChangeMode="live"
              onValueChange={setCustomLowSpeedKmh}
            />
            <Text style={styles.description}>
              High speed · {customHighSpeedKmh.toFixed(0)} km/h
            </Text>
            <TuneDial
              value={customHighSpeedKmh}
              min={-15}
              max={50}
              step={1}
              unit="km/h"
              valueChangeMode="live"
              onValueChange={setCustomHighSpeedKmh}
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
        options={HILLS_OPTIONS}
        value={hillsPreset}
        onChange={handlePresetChange}
      >
        {hillsPreset === 'custom' ? (
          <>
            <Text style={styles.description}>
              Valley-to-peak height · {hillHeightMeters.toFixed(1)} m
            </Text>
            <TuneDial
              value={hillHeightMeters}
              min={0}
              max={50}
              step={0.1}
              unit="m"
              valueChangeMode="live"
              onValueChange={onHillHeightChange}
            />
            <Text style={styles.description}>
              Peak-to-peak distance · {hillSpacingMeters.toFixed(0)} m
            </Text>
            <TuneDial
              value={hillSpacingMeters}
              min={2}
              max={1000}
              step={1}
              unit="m"
              valueChangeMode="live"
              onValueChange={onHillSpacingChange}
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
