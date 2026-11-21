import type { AlertPresetMetric } from '@/modules/alerts/lib/alertPresets'

export const ALERT_PRESET_METRIC_LABELS: Record<AlertPresetMetric, string> = {
  battery: 'Battery',
  speed: 'Speed',
  duty: 'Duty',
  'motor-temp': 'Motor temperature',
  'controller-temp': 'Controller temperature',
}

export const ALERT_PRESET_METRIC_UNITS: Record<AlertPresetMetric, string> = {
  battery: '%',
  speed: 'km/h',
  duty: '%',
  'motor-temp': '°C',
  'controller-temp': '°C',
}
