import { resolvedAlertRules } from '@/modules/alerts/lib/resolvedAlertRules'
import { toTestRule } from '@/modules/alerts/lib/alertTest'
import type { DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'
import { useUnitSystem } from '@/hooks/useUnitSystem'
import { useEffect, useMemo, useState } from 'react'
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { ALERT_BEEP_COUNT_DEFAULT } from 'vescape-core'
import { AlertPresetControl } from '@/modules/alerts/components/AlertPresetControl'
import { draftAlertPreview } from '@/modules/alerts/lib/draftAlertPreview'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import type { AlertPresetLevel, AlertPresetMetric } from '@/modules/alerts/lib/alertPresets'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'

const PRESET_METRICS: AlertPresetMetric[] = [
  'speed',
  'duty',
  'battery',
  'motor-temp',
  'controller-temp',
]

// Full-scale per metric, matching AlertPresetControl's gauge — drives the demo needle sweep.
const PRESET_DEMO_MAX: Record<AlertPresetMetric, number> = {
  speed: 50,
  duty: 100,
  battery: 100,
  'motor-temp': 80,
  'controller-temp': 80,
}

// A couple of custom (non-preset) markers so the showcase demonstrates preset + custom layering.
const PRESET_DEMO_CUSTOM_ALERTS: Record<AlertPresetMetric, { id: string; threshold: number }[]> = {
  speed: [{ id: 'demo-speed', threshold: 45 }],
  duty: [{ id: 'demo-duty', threshold: 92 }],
  battery: [{ id: 'demo-battery', threshold: 10 }],
  'motor-temp': [{ id: 'demo-motor', threshold: 78 }],
  'controller-temp': [{ id: 'demo-controller', threshold: 78 }],
}

// Fixed saved-rule fixtures: this mode demonstrates normal presets following board config.
// Choosing another level returns to the native draft preview.
const MATCHED_NORMAL_FIXTURES: Partial<Record<AlertPresetMetric, DraftAlertRule[]>> = {
  duty: [
    {
      id: 'matched-duty',
      controlId: 'duty',
      threshold: 0,
      thresholdMax: null,
      thresholdRule: {
        kind: 'config-relative',
        fieldId: 'tiltback_duty',
        thresholdOffset: -10,
        thresholdMaxOffset: 0,
      },
      enabled: true,
      createdAt: 0,
      soundType: 'preset:tick',
      repeatEverySeconds: null,
      beepCount: ALERT_BEEP_COUNT_DEFAULT,
    },
  ],
  'motor-temp': [
    {
      id: 'matched-motor-early',
      controlId: 'motor-temp',
      threshold: 0,
      thresholdMax: null,
      thresholdRule: {
        kind: 'config-relative',
        fieldId: 'l_temp_motor_start',
        thresholdOffset: -10,
        thresholdMaxOffset: null,
      },
      enabled: true,
      createdAt: 0,
      soundType: 'tts:Motor {value} {unit}',
      repeatEverySeconds: null,
      beepCount: ALERT_BEEP_COUNT_DEFAULT,
    },
    {
      id: 'matched-motor',
      controlId: 'motor-temp',
      threshold: 0,
      thresholdMax: null,
      thresholdRule: {
        kind: 'config-relative',
        fieldId: 'l_temp_motor_start',
        thresholdOffset: 0,
        thresholdMaxOffset: null,
      },
      enabled: true,
      createdAt: 0,
      soundType: 'tts:Motor {value} {unit}',
      repeatEverySeconds: 10,
      beepCount: ALERT_BEEP_COUNT_DEFAULT,
    },
  ],
  'controller-temp': [
    {
      id: 'matched-controller-early',
      controlId: 'controller-temp',
      threshold: 0,
      thresholdMax: null,
      thresholdRule: {
        kind: 'config-relative',
        fieldId: 'l_temp_fet_start',
        thresholdOffset: -10,
        thresholdMaxOffset: null,
      },
      enabled: true,
      createdAt: 0,
      soundType: 'tts:Controller {value} {unit}',
      repeatEverySeconds: null,
      beepCount: ALERT_BEEP_COUNT_DEFAULT,
    },
    {
      id: 'matched-controller',
      controlId: 'controller-temp',
      threshold: 0,
      thresholdMax: null,
      thresholdRule: {
        kind: 'config-relative',
        fieldId: 'l_temp_fet_start',
        thresholdOffset: 0,
        thresholdMaxOffset: null,
      },
      enabled: true,
      createdAt: 0,
      soundType: 'tts:Controller {value} {unit}',
      repeatEverySeconds: 10,
      beepCount: ALERT_BEEP_COUNT_DEFAULT,
    },
  ],
}
const SHOWCASE_CONFIG_BASES = {
  refloat: { tiltback_duty: 0.82 },
  motor: { l_temp_fet_start: 85, l_temp_motor_start: 100 },
}
const SHOWCASE_CONFIG_BASES_OFF = {
  refloat: { tiltback_duty: 1 },
  motor: { l_temp_fet_start: 0, l_temp_motor_start: 0 },
}

export function AlertPresetControlShowcase() {
  const units = useUnitSystem()
  const [metric, setMetric] = useState<AlertPresetMetric>('speed')
  const [level, setLevel] = useState<AlertPresetLevel>('normal')
  const [live, setLive] = useState(false)
  const [custom, setCustom] = useState(false)
  const [editable, setEditable] = useState(true)
  const [disabled, setDisabled] = useState(false)
  const [match, setMatch] = useState(false)
  const [configOff, setConfigOff] = useState(false)
  const configBases = configOff ? SHOWCASE_CONFIG_BASES_OFF : SHOWCASE_CONFIG_BASES
  const setMatched = (enabled: boolean) => {
    setMatch(enabled)
    if (enabled) setLevel('normal')
  }
  const liveValue = useSharedValue<number | null>(null)
  const preview = useMemo(() => {
    const manual: DraftAlertRule[] =
      level === 'custom' || custom
        ? PRESET_DEMO_CUSTOM_ALERTS[metric].map((rule) => ({
            ...rule,
            controlId: metric,
            thresholdMax: null,
            enabled: true,
            soundType: metric === 'speed' || metric === 'duty' ? 'preset:tick' : 'preset:beep',
            repeatEverySeconds: null,
            beepCount: ALERT_BEEP_COUNT_DEFAULT,
            createdAt: 0,
          }))
        : []
    const fixture = match && level === 'normal' ? MATCHED_NORMAL_FIXTURES[metric] : undefined
    if (fixture)
      return {
        rules: resolvedAlertRules([...fixture, ...manual], configBases).map(toTestRule),
        error: null,
      }
    return draftAlertPreview(
      metric,
      level,
      { speedUnitSystem: units, topSpeedKmh: 50, hasBatteryConfig: true },
      manual,
    )
  }, [level, metric, units, custom, match, configBases])

  useEffect(() => {
    if (!live) {
      liveValue.value = null
      return
    }
    liveValue.value = 0
    liveValue.value = withRepeat(
      withTiming(PRESET_DEMO_MAX[metric], { duration: 2200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    )
    return () => cancelAnimation(liveValue)
  }, [live, metric, liveValue])

  return (
    <ShowcaseCard
      name="AlertPresetControl"
      controls={
        <>
          <ChipRow
            label="metric"
            options={PRESET_METRICS}
            selected={metric}
            onSelect={(v) => setMetric(v as AlertPresetMetric)}
          />
          <ToggleRow label="live session" value={live} onToggle={setLive} />
          <ToggleRow label="custom markers" value={custom} onToggle={setCustom} />
          <ToggleRow label="editable" value={editable} onToggle={setEditable} />
          <ToggleRow label="disabled" value={disabled} onToggle={setDisabled} />
          <ToggleRow label="saved config-match fixture" value={match} onToggle={setMatched} />
          <ToggleRow label="VESC protection off" value={configOff} onToggle={setConfigOff} />
        </>
      }
    >
      {preview.error ? (
        <Text style={{ color: theme.status.error.color }}>{preview.error}</Text>
      ) : null}
      <AlertPresetControl
        metric={metric}
        level={level}
        onLevelChange={(next) => {
          setLevel(next)
          setMatch(false)
        }}
        liveValue={live ? liveValue : undefined}
        boardTopSpeedKmh={50}
        disabled={disabled}
        matchBoardConfig={{ [metric]: match }}
        onMatchBoardConfigChange={setMatched}
        configBases={configBases}
        ruleSnapshot={preview.rules}
        onCustomize={editable ? () => setLevel('custom') : undefined}
        onDiscardCustom={editable ? () => setLevel('normal') : undefined}
      />
    </ShowcaseCard>
  )
}
