import { useMemo, useState } from 'react'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { MetricAlerts } from '@/modules/alerts/components/MetricAlerts'
import { ALERT_PRESET_METRIC_UNITS } from '@/modules/alerts/constants/metricLabels'
import {
  useDraftMetricAlerts,
  validBatteryConfig,
  type DraftAlertSetup,
} from '@/modules/alerts/hooks/useMetricAlerts'
import { ALERT_PRESET_METRICS, type AlertPresetMetric } from '@/modules/alerts/lib/alertPresets'
import { DEFAULT_BATTERY_CONFIG } from '@/modules/battery/lib'

const INITIAL_SETUP: DraftAlertSetup = { level: 'normal', rules: [] }

/** The whole per-metric alert block on an in-memory draft, as the add-board wizard drives it. */
export function MetricAlertsShowcase() {
  const [metric, setMetric] = useState<AlertPresetMetric>('speed')
  const [hasBattery, setHasBattery] = useState(true)
  const [setups, setSetups] = useState<Partial<Record<AlertPresetMetric, DraftAlertSetup>>>({})
  const batteryConfig = useMemo(
    () => (hasBattery ? validBatteryConfig(DEFAULT_BATTERY_CONFIG) : null),
    [hasBattery],
  )
  const controller = useDraftMetricAlerts(metric, {
    setup: setups[metric] ?? INITIAL_SETUP,
    topSpeedKmh: 50,
    hasBatteryConfig: batteryConfig != null,
    batteryConfig,
    onChange: (next) => setSetups((current) => ({ ...current, [metric]: next })),
  })

  return (
    <ShowcaseCard
      name="MetricAlerts"
      controls={
        <>
          <ChipRow
            label="metric"
            options={ALERT_PRESET_METRICS}
            selected={metric}
            onSelect={(v) => setMetric(v as AlertPresetMetric)}
          />
          <ToggleRow label="battery config" value={hasBattery} onToggle={setHasBattery} />
        </>
      }
    >
      <MetricAlerts controller={controller} unit={ALERT_PRESET_METRIC_UNITS[metric]} />
    </ShowcaseCard>
  )
}
