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
import { buildAlertTestRules } from '@/modules/alerts/lib/alertTest'
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

/** Stand-in board configs so the match toggle resolves to real numbers with no board connected. */
const SHOWCASE_CONFIG_BASES = {
  refloat: { tiltback_duty: 0.82 },
  motor: { l_temp_fet_start: 85, l_temp_motor_start: 100 },
}

export function AlertPresetControlShowcase() {
  const [metric, setMetric] = useState<AlertPresetMetric>('speed')
  const [level, setLevel] = useState<AlertPresetLevel>('normal')
  const [live, setLive] = useState(false)
  const [custom, setCustom] = useState(false)
  const [editable, setEditable] = useState(true)
  const [disabled, setDisabled] = useState(false)
  const [match, setMatch] = useState(false)
  const liveValue = useSharedValue<number | null>(null)
  const testRules = useMemo(
    () =>
      buildAlertTestRules({
        metric,
        level,
        boardTopSpeedKmh: 50,
        hasBatteryConfig: true,
        matchBoardConfig: { [metric]: match },
        configBases: SHOWCASE_CONFIG_BASES,
        customRules:
          level === 'custom'
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
            : [],
      }),
    [level, match, metric],
  )

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
          <ToggleRow label="match VESC config" value={match} onToggle={setMatch} />
        </>
      }
    >
      <AlertPresetControl
        metric={metric}
        level={level}
        onLevelChange={setLevel}
        liveValue={live ? liveValue : undefined}
        boardTopSpeedKmh={50}
        hasBatteryConfig
        matchBoardConfig={{ [metric]: match }}
        onMatchBoardConfigChange={setMatch}
        configBases={SHOWCASE_CONFIG_BASES}
        customAlerts={
          custom
            ? PRESET_DEMO_CUSTOM_ALERTS[metric].map((a) => ({ ...a, thresholdMax: null }))
            : undefined
        }
        disabled={disabled}
        testRules={testRules}
        onCustomize={editable ? () => setLevel('custom') : undefined}
        onDiscardCustom={editable ? () => setLevel('normal') : undefined}
      />
    </ShowcaseCard>
  )
}
