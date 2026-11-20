import {
  BatteryEmptyIcon,
  BatteryFullIcon,
  BatteryHighIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  type Icon,
} from 'phosphor-react-native'

import { theme, type ThemeColor } from '@/constants/theme'
import {
  batteryLevel,
  TELEMETRY_LEVEL_COLOR,
  TELEMETRY_THRESHOLDS,
  type TelemetryLevel,
} from '@/modules/board/constants/telemetryThresholds'

export interface BatteryVisual {
  icon: Icon
  level: TelemetryLevel
  /** Battery green when normal, warning/critical status color when low. */
  iconColor: ThemeColor
  /** Value text tint when non-green (warning/critical); undefined when normal. */
  textColor?: ThemeColor
}

/**
 * Picks the Phosphor battery fill icon (0–4 bars) and color from a 0–1 SoC fraction using the
 * shared `TELEMETRY_THRESHOLDS.battery` tiers.
 */
export function batteryVisual(soc: number | null | undefined): BatteryVisual {
  const level = batteryLevel(soc)
  const icon =
    soc == null
      ? BatteryMediumIcon
      : soc < TELEMETRY_THRESHOLDS.battery.critical
        ? BatteryEmptyIcon
        : soc < TELEMETRY_THRESHOLDS.battery.warning
          ? BatteryLowIcon
          : soc < 0.6
            ? BatteryMediumIcon
            : soc < 0.85
              ? BatteryHighIcon
              : BatteryFullIcon

  if (level === 'normal') {
    return { icon, level, iconColor: theme.telemetry.battVoltage }
  }
  const alertColor = TELEMETRY_LEVEL_COLOR[level]
  return { icon, level, iconColor: alertColor, textColor: alertColor }
}
