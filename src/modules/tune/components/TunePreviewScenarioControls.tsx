/* eslint-disable react-hooks/immutability */
import { useCallback, useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { AtomIcon, CaretDownIcon, MountainsIcon, WaveSineIcon } from 'phosphor-react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  useAnimatedReaction,
  useDerivedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { MonoValue } from '@/components/base/MonoValue'
import { Select, type SelectOption } from '@/components/forms/Select'
import { SelectCard } from '@/components/forms/SelectCard'
import { PitchInputControl } from '@/modules/tune/components/PitchInputControl'
import { TuneDial } from '@/modules/tune/components/TuneDial'
import { theme } from '@/constants/theme'
import {
  MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND,
  TUNE_PREVIEW_MOTOR_PRESETS,
  calculateTerrainLoadCurrentAmps,
  pitchInputRateToControlDegrees,
  resolveTunePreviewPhysics,
  type TunePreviewAdvancedPhysics,
  type TunePreviewMotorPresetId,
} from '@/modules/tune/lib/tunePreview'

const MOTOR_OPTIONS: SelectOption<TunePreviewMotorPresetId>[] = Object.entries(
  TUNE_PREVIEW_MOTOR_PRESETS,
).map(([value, preset]) => ({ value: value as TunePreviewMotorPresetId, label: preset.label }))

export type HillsPresetId = 'flat' | 'large' | 'small' | 'pumptrack' | 'custom'

export const HILLS_PRESETS: Record<
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

type MovementPresetId = 'none' | 'manual' | 'slow' | 'rapid' | 'frontBack' | 'custom'
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
  { value: 'none', label: 'Off' },
  { value: 'slow', label: 'Wide speed range · 5-35 km/h' },
  { value: 'rapid', label: 'Quick speed range · 15-30 km/h' },
  { value: 'frontBack', label: 'Forward/back range · -10-10 km/h' },
  { value: 'custom', label: 'Custom range' },
  { value: 'manual', label: 'Manual pitch slider' },
]

interface TunePreviewScenarioControlsProps {
  advancedPhysics: TunePreviewAdvancedPhysics
  onAdvancedPhysicsChange: (physics: TunePreviewAdvancedPhysics) => void
  hillsPreset: HillsPresetId
  onHillsPresetChange: (preset: HillsPresetId) => void
  hillHeightMeters: number
  onHillHeightChange: (value: number) => void
  hillSpacingMeters: number
  onHillSpacingChange: (value: number) => void
  hillsEnabled: boolean
  hillLoadAmps: SharedValue<number>
  pitchInputDegrees: SharedValue<number>
  pitchInputActive: SharedValue<boolean>
  speedKmh: SharedValue<number>
  groundToBoardAngleDegrees: SharedValue<number>
}

export function TunePreviewScenarioControls({
  advancedPhysics,
  onAdvancedPhysicsChange,
  hillsPreset,
  onHillsPresetChange,
  hillHeightMeters,
  onHillHeightChange,
  hillSpacingMeters,
  onHillSpacingChange,
  hillsEnabled,
  hillLoadAmps,
  pitchInputDegrees,
  pitchInputActive,
  speedKmh,
  groundToBoardAngleDegrees,
}: TunePreviewScenarioControlsProps) {
  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const [movementPreset, setMovementPreset] = useState<MovementPresetId>('slow')
  const [customLowSpeedKmh, setCustomLowSpeedKmh] = useState(10)
  const [customHighSpeedKmh, setCustomHighSpeedKmh] = useState(25)
  const [customRateDegreesPerSecond, setCustomRateDegreesPerSecond] = useState(100)
  const movementDirectionRef = useRef<MovementDirection>('nose')
  const movementPresetRef = useRef<MovementPresetId>('slow')
  const physics = resolveTunePreviewPhysics(advancedPhysics)
  const tenPercentGradeCurrent = calculateTerrainLoadCurrentAmps(0.1, physics)
  const updatePhysics = (patch: Partial<TunePreviewAdvancedPhysics>) =>
    onAdvancedPhysicsChange({ ...physics, ...patch })

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
      if (activeMovementPreset === 'manual' || activeMovementPreset === 'none') return

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
    if (preset === 'manual' || preset === 'none') {
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

      <View style={styles.container}>
        <Pressable
          style={styles.header}
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedExpanded }}
          onPress={() => setAdvancedExpanded((expanded) => !expanded)}
        >
          <View style={styles.titleRow}>
            <AtomIcon size={16} color={theme.palette.purple.color} weight="duotone" />
            <View>
              <Text style={styles.title}>Advanced settings</Text>
              <Text style={styles.description}>Physical model of the board</Text>
            </View>
          </View>
          <CaretDownIcon
            size={16}
            color={theme.palette.slate.textMuted}
            weight="bold"
            style={{ transform: [{ rotate: advancedExpanded ? '180deg' : '0deg' }] }}
          />
        </Pressable>
        {advancedExpanded ? (
          <Animated.View
            entering={FadeIn.duration(150)}
            exiting={FadeOut.duration(100)}
            style={styles.physicsControls}
          >
            <Text style={styles.summaryText}>
              10% grade requires approximately {tenPercentGradeCurrent.toFixed(1)} A
            </Text>
            {hillsEnabled ? <HillLoadReadout value={hillLoadAmps} /> : null}
            <Text style={styles.description}>Motor preset</Text>
            <Select
              options={MOTOR_OPTIONS}
              value={physics.motorPresetId}
              onChange={(motorPresetId) => {
                const preset = TUNE_PREVIEW_MOTOR_PRESETS[motorPresetId]
                updatePhysics({ motorPresetId, motorTorqueNmPerAmp: preset.motorTorqueNmPerAmp })
              }}
            />
            <Text style={styles.description}>
              Rider + Board mass · {physics.totalMassKg.toFixed(0)} kg
            </Text>
            <TuneDial
              value={physics.totalMassKg}
              min={30}
              max={250}
              step={1}
              unit="kg"
              valueChangeMode="live"
              onValueChange={(totalMassKg) => updatePhysics({ totalMassKg })}
            />
            <Text style={styles.description}>
              Motor torque constant · {physics.motorTorqueNmPerAmp.toFixed(2)} Nm/A
            </Text>
            <TuneDial
              value={physics.motorTorqueNmPerAmp}
              min={0.2}
              max={1.5}
              step={0.01}
              unit="Nm/A"
              valueChangeMode="live"
              onValueChange={(motorTorqueNmPerAmp) => updatePhysics({ motorTorqueNmPerAmp })}
            />
            <Text style={styles.description}>
              Motor current limit · {physics.maxMotorCurrentAmps.toFixed(0)} A
            </Text>
            <TuneDial
              value={physics.maxMotorCurrentAmps}
              min={10}
              max={150}
              step={1}
              unit="A"
              valueChangeMode="live"
              onValueChange={(maxMotorCurrentAmps) => updatePhysics({ maxMotorCurrentAmps })}
            />
            <Text style={styles.description}>
              Wheel diameter · {physics.wheelDiameterInches.toFixed(1)} in
            </Text>
            <TuneDial
              value={physics.wheelDiameterInches}
              min={8}
              max={20}
              step={0.1}
              unit="in"
              valueChangeMode="live"
              onValueChange={(wheelDiameterInches) => updatePhysics({ wheelDiameterInches })}
            />
            <Text style={styles.description}>
              Motor poles · {physics.motorPoleCount.toFixed(0)}
            </Text>
            <TuneDial
              value={physics.motorPoleCount}
              min={2}
              max={60}
              step={2}
              valueChangeMode="live"
              onValueChange={(motorPoleCount) => updatePhysics({ motorPoleCount })}
            />
            <Text style={styles.description}>
              Drivetrain efficiency · {(physics.drivetrainEfficiency * 100).toFixed(0)}%
            </Text>
            <TuneDial
              value={physics.drivetrainEfficiency * 100}
              min={50}
              max={100}
              step={1}
              unit="%"
              valueChangeMode="live"
              onValueChange={(efficiencyPercent) =>
                updatePhysics({ drivetrainEfficiency: efficiencyPercent / 100 })
              }
            />
            <Text style={styles.description}>
              Center-of-mass height · {physics.centerOfMassHeightMeters.toFixed(2)} m
            </Text>
            <TuneDial
              value={physics.centerOfMassHeightMeters}
              min={0.4}
              max={1.5}
              step={0.01}
              unit="m"
              valueChangeMode="live"
              onValueChange={(centerOfMassHeightMeters) =>
                updatePhysics({ centerOfMassHeightMeters })
              }
            />
            <Text style={styles.description}>
              Pitch damping · {physics.pitchDampingPerSecond.toFixed(1)} /s
            </Text>
            <TuneDial
              value={physics.pitchDampingPerSecond}
              min={0}
              max={30}
              step={0.5}
              unit="/s"
              valueChangeMode="live"
              onValueChange={(pitchDampingPerSecond) => updatePhysics({ pitchDampingPerSecond })}
            />
          </Animated.View>
        ) : null}
      </View>
    </View>
  )
}

const SUMMARY_FONT_SIZE = 11

const styles = StyleSheet.create({
  stack: {
    gap: 8,
  },
  container: {
    gap: 4,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    borderRadius: 10,
    padding: 12,
    backgroundColor: theme.palette.slate.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: theme.palette.slate.textPrimary, fontSize: 13, fontWeight: '900' },
  description: { color: theme.palette.slate.textMuted, fontSize: 10, fontWeight: '600' },
  physicsControls: { gap: 4 },
  summaryText: {
    color: theme.telemetry.motorCurrent,
    fontSize: SUMMARY_FONT_SIZE,
    fontFamily: theme.mono('800'),
  },
  valueSummary: {
    alignSelf: 'stretch',
  },
})

function HillLoadReadout({ value }: { value: SharedValue<number> }) {
  const text = useDerivedValue(() => {
    const v = value.value
    return `Hill load ${v >= 0 ? '+' : ''}${v.toFixed(1)} A`
  })
  return (
    <MonoValue
      text={text}
      size={SUMMARY_FONT_SIZE}
      weight="800"
      color={theme.telemetry.motorCurrent}
      style={styles.valueSummary}
    />
  )
}
