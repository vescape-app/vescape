import type { AlertPresetMetric } from '@/modules/alerts/lib/alertPresets'

/** Screen-facing metric names for alert setup (JS-only presentation). */
export const ALERT_PRESET_METRIC_LABELS: Record<AlertPresetMetric, string> = {
  battery: 'Battery',
  speed: 'Speed',
  duty: 'Duty',
  'motor-temp': 'Motor temperature',
  'controller-temp': 'Controller temperature',
}

/** Unit suffix shown next to a rule's threshold. Battery rules are state-of-charge %. */
export const ALERT_PRESET_METRIC_UNITS: Record<AlertPresetMetric, string> = {
  battery: '%',
  speed: 'km/h',
  duty: '%',
  'motor-temp': '°C',
  'controller-temp': '°C',
}
