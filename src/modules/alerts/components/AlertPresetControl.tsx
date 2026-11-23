import { useFormat } from '@/hooks/useFormat'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import {
  speedFromKmh,
  speedUnit,
  temperatureDisplayOffset,
  temperatureDisplayScale,
  temperatureFromC,
  temperatureSymbol,
} from '@/helpers/units'
import { type ReactNode, useEffect, useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { SpeakerHighIcon, StopIcon, CheckIcon } from 'phosphor-react-native'
import type { AlertTestRule } from 'vescape-core'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import type { DualGaugeAlert } from '@/components/charts/gaugeAlert'
import { SingleGauge } from '@/modules/board/components/SingleGauge'
import { telemetry } from '@/modules/board/constants/telemetry'
import {
  ALERT_PRESET_CONFIG_FIELDS,
  supportsBoardConfigMatch,
  type AlertPresetLevel,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'
import { useAlertPresetFormat } from '@/modules/alerts/hooks/useAlertPresetFormat'
import {
  configRelativeBase,
  type BoardConfigBases,
} from '@/modules/alerts/lib/configRelativeFields'
import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { useAlertTest } from '@/modules/alerts/hooks/useAlertTest'
import { PresetGeigerSound } from '@/modules/alerts/components/PresetGeigerSound'

interface PresetGaugeDescriptor {
  color: ThemeColor
  unit: string
  decimals: number
  min: number
  defaultMax: number
  formatMarker: (value: number) => string
}

const round = (value: number) => Math.round(value)

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

export interface PresetGaugeHotRange {
  start: number
  end: number
}

interface AlertPresetControlProps {
  metric: AlertPresetMetric
  level: AlertPresetLevel
  onLevelChange: (level: AlertPresetLevel) => void
  liveValue?: SharedValue<number | null>
  boardTopSpeedKmh?: number | null
  matchBoardConfig?: Partial<Record<AlertPresetMetric, boolean>>
  onMatchBoardConfigChange?: (enabled: boolean) => void
  geigerSound?: string | null
  onGeigerSoundChange?: (spec: string) => void
  configBases?: BoardConfigBases
  hotRange?: PresetGaugeHotRange | null
  levelDisabled?: boolean
  ruleSnapshot: AlertTestRule[]
  presetRules: AlertTestRule[]
  controlsHeader?: ReactNode
}

export function AlertPresetControl({
  metric,
  level,
  onLevelChange,
  liveValue,
  boardTopSpeedKmh,
  matchBoardConfig,
  onMatchBoardConfigChange,
  geigerSound,
  onGeigerSoundChange,
  configBases,
  hotRange,
  levelDisabled,
  ruleSnapshot,
  presetRules,
  controlsHeader,
}: AlertPresetControlProps) {
  const { distanceUnit, temperatureUnit } = useUserPreferences()
  const { formatSpeedWithUnit } = useFormat()
  const { describeRules } = useAlertPresetFormat()
  const isTemp = metric === 'motor-temp' || metric === 'controller-temp'
  const gauge = useMemo(
    () =>
      metric === 'speed'
        ? {
            ...PRESET_GAUGE.speed,
            unit: speedUnit(distanceUnit),
            formatMarker: (value: number) => formatSpeedWithUnit(value, 1),
          }
        : isTemp
          ? {
              ...PRESET_GAUGE[metric],
              unit: temperatureSymbol(temperatureUnit),
              formatMarker: (value: number) =>
                `${round(temperatureFromC(value, temperatureUnit))}°`,
            }
          : PRESET_GAUGE[metric],
    [metric, distanceUnit, temperatureUnit, isTemp, formatSpeedWithUnit],
  )
  const max =
    metric === 'speed' && boardTopSpeedKmh && boardTopSpeedKmh > 0
      ? boardTopSpeedKmh
      : gauge.defaultMax

  const alerts = useMemo<DualGaugeAlert[]>(
    () =>
      ruleSnapshot.map((rule) => ({
        id: rule.id,
        threshold: rule.threshold,
        thresholdMax: rule.thresholdMax,
        repeats: rule.repeatEverySeconds != null,
        label: gauge.formatMarker(rule.threshold),
        labelMax: rule.thresholdMax == null ? undefined : gauge.formatMarker(rule.thresholdMax),
      })),
    [ruleSnapshot, gauge],
  )

  const placeholder = useSharedValue<number | null>(null)

  const alertTest = useAlertTest({
    rules: ruleSnapshot,
    min: gauge.min,
    max,
    alertAbove: metric !== 'battery',
  })
  const gaugeValue = alertTest.running ? alertTest.value : liveValue
  const description =
    presetRules.length > 0
      ? describeRules(metric, presetRules)
      : level === 'off'
        ? ruleSnapshot.length === 0
          ? 'No sound from this metric.'
          : 'Preset off — only your own alerts below sound.'
        : null

  return (
    <View style={styles.container}>
      <SingleGauge
        displayScale={
          metric === 'speed'
            ? speedFromKmh(1, distanceUnit)
            : isTemp
              ? temperatureDisplayScale(temperatureUnit)
              : 1
        }
        displayOffset={isTemp ? temperatureDisplayOffset(temperatureUnit) : 0}
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
      <View style={styles.headerRow}>
        {controlsHeader}
        <Button
          label={alertTest.running ? 'Stop' : 'Preview'}
          icon={alertTest.running ? StopIcon : SpeakerHighIcon}
          variant="caution"
          size="sm"
          disabled={!alertTest.canRun}
          onPress={alertTest.running ? alertTest.stop : alertTest.start}
          testID={`alert-test-${metric}`}
          style={styles.testButton}
        />
      </View>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {supportsBoardConfigMatch(metric) ? (
        <BoardConfigMatchControl
          metric={metric}
          checked={matchBoardConfig?.[metric] === true}
          configBases={configBases}
          formatValue={gauge.formatMarker}
          onChange={onMatchBoardConfigChange}
        />
      ) : null}
      <LevelSlider
        metric={metric}
        value={level}
        onChange={onLevelChange}
        disabled={levelDisabled}
      />
      {level === 'off' ? null : (
        <PresetGeigerSound spec={geigerSound} onChange={onGeigerSoundChange} />
      )}
    </View>
  )
}

const MATCH_SUBJECT: Partial<Record<AlertPresetMetric, string>> = {
  duty: 'duty pushback',
  'motor-temp': 'motor temperature limiting',
  'controller-temp': 'controller temperature limiting',
}

function BoardConfigMatchControl({
  metric,
  checked,
  configBases,
  formatValue,
  onChange,
}: {
  metric: AlertPresetMetric
  checked: boolean
  configBases?: BoardConfigBases
  formatValue: (value: number) => string
  onChange?: (enabled: boolean) => void
}) {
  const fieldId = ALERT_PRESET_CONFIG_FIELDS[metric]
  const base =
    fieldId == null
      ? { status: 'missing' as const }
      : configRelativeBase(fieldId, configBases ?? {})
  const subject = MATCH_SUBJECT[metric] ?? 'configuration'
  const format = formatValue
  const available = base.status === 'resolved'
  const interactive = available || checked
  let note: string | null = null
  if (base.status === 'resolved') {
    note = checked ? `Follows VESC ${subject} (${format(base.value)}).` : null
  } else if (base.status === 'disabled') {
    note = `VESC ${subject} is off (${format(base.value)}) — there is nothing to match.`
  } else if (base.status === 'unread') {
    note = `Connect to the board to read its ${subject} setting first.`
  } else {
    note = `This board's firmware does not report a ${subject} setting.`
  }
  return (
    <View>
      <Pressable
        style={[styles.matchRow, !available && styles.matchRowDisabled]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: !interactive }}
        disabled={!interactive}
        onPress={() => onChange?.(!checked)}
      >
        <View style={[styles.checkbox, checked && available && styles.checkboxChecked]}>
          {checked && available ? (
            <CheckIcon size={13} color={theme.neutral.textPrimary} weight="bold" />
          ) : null}
        </View>
        <Text style={styles.matchLabel}>Match VESC board configuration</Text>
      </Pressable>
      {note ? <Text style={styles.matchNote}>{note}</Text> : null}
    </View>
  )
}

interface LevelTone {
  bg: string
  border: ThemeColor
  color: ThemeColor
}

const LEVEL_OPTIONS: { id: AlertPresetLevel; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'normal', label: 'Normal' },
  { id: 'safe', label: 'Safe' },
]

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
  }
  const activeIndex = ALL_LEVELS.indexOf(value)
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
    color: theme.neutral.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 34 },
  matchRowDisabled: { opacity: 0.45 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: theme.palette.blue.bg,
    borderColor: theme.palette.blue.border,
  },
  matchLabel: { color: theme.neutral.textPrimary, fontSize: 14, fontWeight: '600' },
  matchNote: { color: theme.neutral.textMuted, fontSize: 12, lineHeight: 17, marginLeft: 28 },
  testButton: {
    height: 28,
    paddingHorizontal: 10,
    flexShrink: 0,
  },
  slider: {
    flexDirection: 'row',
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
    borderWidth: 1,
    borderColor: theme.alpha(theme.neutral.textSecondary, 0.3),
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
