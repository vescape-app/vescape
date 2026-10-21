import { fmtPercent, fmtTempC } from '@/helpers/format'
import { formatSpeedMps, type UnitSystem } from '@/helpers/units'
import {
  batteryLevel,
  tempLevel,
  type TelemetryLevel,
} from '@/modules/board/constants/telemetryThresholds'
import type { RosterRider } from '@/modules/group-ride/lib/roster'

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

/** Per-Rider telemetry values for the roster stat grid, each carrying its alert level. */
export function riderStats(p: RosterRider['presence'], units: UnitSystem): RiderStats {
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
      value: p.speed != null ? formatSpeedMps(p.speed, units) : undefined,
      level: 'normal',
    },
    soc: {
      value: p.soc != null ? fmtPercent(p.soc) : undefined,
      level: batteryLevel(p.soc),
    },
    motor: {
      value: p.motorTemp != null ? `M ${fmtTempC(p.motorTemp)}` : undefined,
      level: tempLevel(p.motorTemp),
    },
    ctrl: {
      value: p.ctrlTemp != null ? `C ${fmtTempC(p.ctrlTemp)}` : undefined,
      level: tempLevel(p.ctrlTemp),
    },
    phone: {
      value: p.phoneBattery != null ? fmtPercent(p.phoneBattery) : undefined,
      level: 'normal',
    },
  }
}
