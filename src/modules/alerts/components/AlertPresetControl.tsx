import { type ReactNode, useEffect, useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  PencilSimpleIcon,
  SlidersHorizontalIcon,
  SpeakerHighIcon,
  StopIcon,
  TrashIcon,
} from 'phosphor-react-native'
import type { AlertTestRule } from 'vescape-core'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import { IconButton } from '@/components/base/IconButton'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import type { DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { SingleGauge } from '@/modules/board/components/SingleGauge'
import { telemetry } from '@/modules/board/constants/telemetry'
import {
  describeAlertPreset,
  generateAlertPresetRules,
  type AlertPresetLevel,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { useAlertTest } from '@/modules/alerts/hooks/useAlertTest'

/**
 * The shared preset control: an Off/Safe/Normal/Minimal level slider over an enlarged,
 * labeled gauge preview. The markers are derived straight from the pure generator
 * (`generateAlertPresetRules`), so the preview renders offline — no board, no
 * persisted rules required. When a live telemetry {@link SharedValue} is supplied
 * the needle + readout overlay the static markers.
 *
 * Presentational + controlled: it owns no store. Callers bind `level`/`onLevelChange`
 * to the Alert Preset store and pass `boardTopSpeedKmh`/`hasBatteryConfig` from
 * settings + the active board.
 */

interface PresetGaugeDescriptor {
  color: string
  /** Readout unit shown under the live value. */
  unit: string
  decimals: number
  min: number
  /** Full-scale value; speed overrides this with Board Top Speed. */
  defaultMax: number
  /** Compact label drawn at a threshold marker (e.g. `20%`, `70°`, `38 km/h`). */
  formatMarker: (value: number) => string
}

const round = (value: number) => Math.round(value)

// JS-only presentation: colors, units, and label formatting the gauge preview draws.
// Battery is percent-scaled here (its thresholds are SoC %), unlike the voltage telemetry metric.
const PRESET_GAUGE: Record<AlertPresetMetric, PresetGaugeDescriptor> = {
  battery: {
    color: telemetry.battVoltage.color,
    unit: '%',
    decimals: 0,
    min: 0,
    defaultMax: 100,
    formatMarker: (v) => `${round(v)}%`,
  },
  speed: {
    color: telemetry.speed.color,
    unit: 'km/h',
    decimals: 0,
    min: 0,
    defaultMax: telemetry.speed.chartRange.max,
    formatMarker: (v) => `${round(v)} km/h`,
  },
  duty: {
    color: telemetry.duty.color,
    unit: '%',
    decimals: 0,
    min: 0,
    defaultMax: 100,
    formatMarker: (v) => `${round(v)}%`,
  },
  'motor-temp': {
    color: telemetry.motorTemp.color,
    unit: '°C',
    decimals: 0,
    min: 0,
    defaultMax: telemetry.motorTemp.chartRange.max,
    formatMarker: (v) => `${round(v)}°`,
  },
  'controller-temp': {
    color: telemetry.controllerTemp.color,
    unit: '°C',
    decimals: 0,
    min: 0,
    defaultMax: telemetry.controllerTemp.chartRange.max,
    formatMarker: (v) => `${round(v)}°`,
  },
}

/**
 * Structural mirror of the gauge hot-range span. Kept local so this alerts-module
 * component never imports the history module (no `alerts → history` edge); it is
 * assignable to {@link SingleGauge}'s `MetricHotRange` prop.
 */
interface PresetGaugeHotRange {
  start: number
  end: number
}

interface AlertPresetControlProps {
  metric: AlertPresetMetric
  level: AlertPresetLevel
  onLevelChange: (level: AlertPresetLevel) => void
  /** Live telemetry value; when supplied the gauge overlays a moving needle + readout. */
  liveValue?: SharedValue<number | null>
  /** Board Top Speed (km/h) — resolves speed thresholds and the speed gauge full-scale. */
  boardTopSpeedKmh?: number | null
  /** Whether the active board has a valid battery config (battery markers need one). */
  hasBatteryConfig?: boolean
  /** Custom (non-preset) alert markers layered onto the same gauge alongside the preset markers. */
  customAlerts?: DualGaugeAlert[]
  /** History hot-range gradient for the gauge arc (kept in sync with the detail gauge). */
  hotRange?: PresetGaugeHotRange | null
  /** Blocks slider interaction and dims it (e.g. battery without a valid config). */
  disabled?: boolean
  /** Exact visible rules to evaluate while the synthetic needle sweeps the gauge. */
  testRules?: AlertTestRule[]
  /** Detail-screen Alerts heading, placed directly below the gauge. */
  controlsHeader?: ReactNode
  /** Take ownership of this level's rules. Omitted where custom rules aren't offered (the gauge
   * preview in board settings), which also hides the action button. */
  onCustomize?: () => void
  /** Give the metric back to the presets. Only reachable while `level` is `custom`. */
  onDiscardCustom?: () => void
}

export function AlertPresetControl({
  metric,
  level,
  onLevelChange,
  liveValue,
  boardTopSpeedKmh,
  hasBatteryConfig,
  customAlerts,
  hotRange,
  disabled,
  testRules = [],
  controlsHeader,
  onCustomize,
  onDiscardCustom,
}: AlertPresetControlProps) {
  const gauge = PRESET_GAUGE[metric]
  const max =
    metric === 'speed' && boardTopSpeedKmh && boardTopSpeedKmh > 0
      ? boardTopSpeedKmh
      : gauge.defaultMax

  const alerts = useMemo<DualGaugeAlert[]>(() => {
    const specs = generateAlertPresetRules(metric, level, {
      boardTopSpeedKmh,
      hasBatteryConfig,
    })
    // Preset markers come straight from the pure generator (instant + atomic as the slider
    // moves, no store round-trip flicker); custom markers layer on top from the caller.
    const presetMarkers = specs.map((spec, index) => ({
      id: `${metric}-${index}`,
      threshold: spec.threshold,
      thresholdMax: spec.thresholdMax,
      repeats: spec.repeatEverySeconds != null,
      label: gauge.formatMarker(spec.threshold),
      labelMax: spec.thresholdMax == null ? undefined : gauge.formatMarker(spec.thresholdMax),
    }))
    if (!customAlerts) return presetMarkers
    // Custom markers arrive as bare thresholds; this component owns the per-metric formatting, so
    // label them here rather than making every caller reproduce it.
    return [
      ...presetMarkers,
      ...customAlerts.map((alert) => ({
        ...alert,
        label: alert.label ?? gauge.formatMarker(alert.threshold),
        labelMax:
          alert.labelMax ??
          (alert.thresholdMax == null ? undefined : gauge.formatMarker(alert.thresholdMax)),
      })),
    ]
  }, [metric, level, boardTopSpeedKmh, hasBatteryConfig, gauge, customAlerts])

  // A stable null placeholder so the gauge always has a SharedValue; the needle is hidden offline.
  const placeholder = useSharedValue<number | null>(null)

  const isCustom = level === 'custom'
  const editAction = isCustom ? onDiscardCustom : onCustomize
  const alertTest = useAlertTest({
    rules: testRules,
    min: gauge.min,
    max,
    alertAbove: metric !== 'battery',
    lingerNearMax: metric === 'speed' || metric === 'duty',
    slowForMessages: metric === 'motor-temp' || metric === 'controller-temp',
  })
  const gaugeValue = alertTest.running ? alertTest.value : liveValue
  // Says what this level actually sounds like — the ramp is otherwise learned by riding it.
  const description = describeAlertPreset(metric, level, { boardTopSpeedKmh, hasBatteryConfig })

  return (
    <View style={styles.container}>
      <SingleGauge
        value={gaugeValue ?? placeholder}
        min={gauge.min}
        max={max}
        color={gauge.color}
        unit={gauge.unit}
        decimals={gauge.decimals}
        alerts={alerts}
        hotRange={hotRange}
        showValue={gaugeValue != null}
        containerStyle={styles.gauge}
      />
      {/* The test drives the alerts, so it sits with the Alerts heading rather than the gauge. */}
      <View style={styles.headerRow}>
        {controlsHeader}
        <Button
          label={alertTest.running ? 'Stop' : 'Preview'}
          icon={alertTest.running ? StopIcon : SpeakerHighIcon}
          variant="caution"
          size="sm"
          disabled={disabled || !alertTest.canRun}
          onPress={alertTest.running ? alertTest.stop : alertTest.start}
          testID={`alert-test-${metric}`}
          style={styles.testButton}
        />
      </View>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      <View style={styles.levelRow}>
        {isCustom ? (
          <CustomLabel />
        ) : (
          <LevelSlider metric={metric} value={level} onChange={onLevelChange} disabled={disabled} />
        )}
        {editAction && !disabled ? (
          <IconButton
            icon={isCustom ? TrashIcon : PencilSimpleIcon}
            destructive={isCustom}
            accessibilityLabel={isCustom ? 'Discard custom alerts' : 'Edit alerts'}
            onPress={editAction}
          />
        ) : null}
      </View>
    </View>
  )
}

/**
 * Stands in for the level slider once the rider owns the metric's rules — there is no level.
 * Deliberately flat and unfilled: it is a status label, and anything pill-shaped in this row
 * reads as a button the rider then taps to no effect.
 */
function CustomLabel() {
  return (
    <View style={styles.customLabel}>
      <SlidersHorizontalIcon size={14} color={theme.neutral.textMuted} weight="bold" />
      <Text style={styles.customLabelText}>Custom alerts</Text>
    </View>
  )
}

interface LevelTone {
  bg: string
  border: string
  color: string
}

const LEVEL_OPTIONS: { id: AlertPresetLevel; label: string }[] = [
  { id: 'off', label: 'Off' },
  // Rising cautiousness left to right, so the row reads as one ramp out of `off`: risky (yellow)
  // → balanced (green) → careful (blue). Green marks the recommended default; orange and red stay
  // reserved for real alerts, so `minimal` must not borrow either — it is a choice, never a fault.
  { id: 'minimal', label: 'Minimal' },
  { id: 'normal', label: 'Normal' },
  { id: 'safe', label: 'Safe' },
]

/** The row's own order — the preset levels themselves have no ranking. */
const ALL_LEVELS: AlertPresetLevel[] = LEVEL_OPTIONS.map((option) => option.id)
const SLIDER_ANIMATION = { duration: 180 } as const

interface LevelSliderProps {
  metric: AlertPresetMetric
  value: AlertPresetLevel
  onChange: (level: AlertPresetLevel) => void
  disabled?: boolean
}

function LevelSlider({ metric, value, onChange, disabled }: LevelSliderProps) {
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const tones: Record<AlertPresetLevel, LevelTone> = {
    off: { bg: neutral.surface, border: neutral.border, color: neutral.textSecondary },
    safe: accents.blue,
    normal: accents.green,
    minimal: accents.yellow,
    custom: { bg: neutral.surface, border: neutral.border, color: neutral.textMuted },
  }
  const activeIndex = Math.max(0, ALL_LEVELS.indexOf(value))
  const tone = tones[value]
  const progress = useSharedValue(activeIndex)

  useEffect(() => {
    progress.value = withTiming(activeIndex, SLIDER_ANIMATION)
  }, [activeIndex, progress])

  const highlightPositionStyle = useAnimatedStyle(
    () => ({
      left: `${(progress.value / LEVEL_OPTIONS.length) * 100}%`,
    }),
    [],
  )
  const highlightColorStyle = useAnimatedStyle(
    () => ({
      backgroundColor: tone.bg,
      borderColor: tone.border,
    }),
    [tone.bg, tone.border],
  )

  return (
    <View style={[styles.slider, disabled && styles.sliderDisabled]}>
      <Animated.View style={[styles.sliderHighlightSlot, highlightPositionStyle]}>
        <Animated.View style={[styles.sliderHighlight, highlightColorStyle]} />
      </Animated.View>
      {LEVEL_OPTIONS.map((option) => {
        const active = option.id === value
        const optionTone = tones[option.id]
        return (
          <Pressable
            key={option.id}
            testID={`alert-level-${metric}-${option.id}`}
            style={styles.sliderSegment}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            accessibilityLabel={active ? `${option.label}, selected` : option.label}
            disabled={disabled}
            onPress={() => onChange(option.id)}
          >
            <Text
              style={[
                styles.sliderLabel,
                { color: active ? optionTone.color : theme.neutral.textMuted },
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  gauge: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  description: {
    color: theme.palette.slate.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  testButton: {
    height: 28,
    paddingHorizontal: 10,
    flexShrink: 0,
  },
  customLabel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
  },
  customLabelText: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  slider: {
    flex: 1,
    flexDirection: 'row',
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.slate.light, 0.3),
    position: 'relative',
    overflow: 'hidden',
  },
  sliderDisabled: {
    opacity: 0.45,
  },
  sliderHighlightSlot: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    width: `${100 / LEVEL_OPTIONS.length}%`,
  },
  sliderHighlight: {
    flex: 1,
    marginHorizontal: 1,
    borderRadius: 16,
    borderWidth: 1,
  },
  sliderSegment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
})
