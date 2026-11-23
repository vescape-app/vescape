import { fmtPercent } from '@/helpers/format'
import {
  formatSpeedValue,
  formatTemperatureValue,
  type DistanceUnit,
  type TemperatureUnit,
} from '@/helpers/units'
import {
  batteryLevel,
  tempLevel,
  type TelemetryLevel,
} from '@/modules/board/constants/telemetryThresholds'
import type { RiderPresence } from 'vescape-core'

export type RiderReadings = Pick<
  RiderPresence,
  'speed' | 'soc' | 'motorTemp' | 'ctrlTemp' | 'phoneBattery' | 'boardName'
>

interface RiderStat {
  value?: string
  level: TelemetryLevel
}

interface RiderStats {
  speed: RiderStat
  soc: RiderStat
  motor: RiderStat
  ctrl: RiderStat
  phone: RiderStat
}

const NORMAL_STAT: RiderStat = { level: 'normal' }

export function riderStats(
  p: RiderReadings | null,
  distanceUnit: DistanceUnit,
  temperatureUnit: TemperatureUnit = 'celsius',
): RiderStats {
  if (!p)
    return {
      speed: NORMAL_STAT,
      soc: NORMAL_STAT,
      motor: NORMAL_STAT,
      ctrl: NORMAL_STAT,
      phone: NORMAL_STAT,
    }
  return {
    speed: {
      value: p.speed != null ? formatSpeedValue(p.speed * 3.6, distanceUnit) : undefined,
      level: 'normal',
    },
    soc: {
      value: p.soc != null ? fmtPercent(p.soc) : undefined,
      level: batteryLevel(p.soc),
    },
    motor: {
      value:
        p.motorTemp != null
          ? `${formatTemperatureValue(p.motorTemp, temperatureUnit)}°`
          : undefined,
      level: tempLevel(p.motorTemp),
    },
    ctrl: {
      value:
        p.ctrlTemp != null ? `${formatTemperatureValue(p.ctrlTemp, temperatureUnit)}°` : undefined,
      level: tempLevel(p.ctrlTemp),
    },
    phone: {
      value: p.phoneBattery != null ? fmtPercent(p.phoneBattery) : undefined,
      level: 'normal',
    },
  }
}
