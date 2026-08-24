import {
  erpm,
  percent,
  unit,
  type BoardConfigRow,
} from '@/modules/board/components/BoardConfigSection'

/**
 * Which VESC motor config (MCCONF) fields each `/control/<metric>` screen shows beside its live
 * telemetry. Separate from `boardConfigRows.ts` because the two configs come from different places:
 * Refloat serves its own schema, VESC serves a bare blob decoded against a signature (ADR 0036).
 *
 * Labels are hand-written rather than imported from VESC Tool's XML: these few rows describe what the
 * board *does* at each threshold, which is the thing a rider watching a temperature chart wants to
 * know, and VESC Tool's own wording ("Start", "End") does not say it.
 */

/** Temperatures are whole degrees on the board; a decimal implies precision it does not have. */
const celsius = unit('°C', 0)

/**
 * What the controller does as its MOSFETs heat up: current is scaled down linearly from the start
 * temperature and reaches zero at the end temperature.
 */
export const CONTROLLER_TEMP_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'l_temp_fet_start', label: 'Power limiting starts at', format: celsius },
  { id: 'l_temp_fet_end', label: 'Power fully cut at', format: celsius },
]

/** The same ramp, driven by the motor's own temperature sensor. */
export const MOTOR_TEMP_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'l_temp_motor_start', label: 'Power limiting starts at', format: celsius },
  { id: 'l_temp_motor_end', label: 'Power fully cut at', format: celsius },
]

/** Currents are set in whole amps; a decimal implies a precision nobody tunes to. */
const amps = unit('A', 0)

/**
 * The controller's own current limits — the ceiling every other current setting lives under, and
 * the reason a trace flattens where it does.
 */
export const MOTOR_CURRENT_MOTOR_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'l_current_max', label: 'Motor current limit', format: amps },
  { id: 'l_current_min', label: 'Braking current limit', format: amps },
  { id: 'l_abs_current_max', label: 'Absolute current cutoff', format: amps },
]

/** What the controller will pull from, and push back into, the pack. */
export const BATTERY_CURRENT_MOTOR_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'l_in_current_max', label: 'Battery current limit', format: amps },
  { id: 'l_in_current_min', label: 'Regen current limit', format: amps },
]

/**
 * The controller's own voltage protection, under everything Refloat does: it scales power down
 * from the cutoff start and stops entirely at the end, whatever the rider set as pushback.
 */
export const BATTERY_MOTOR_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'l_battery_cut_start', label: 'Power limiting starts at', format: (v) => voltage(v) },
  { id: 'l_battery_cut_end', label: 'Power fully cut at', format: (v) => voltage(v) },
  { id: 'l_min_vin', label: 'Minimum input voltage', format: (v) => voltage(v) },
  { id: 'l_max_vin', label: 'Maximum input voltage', format: (v) => voltage(v) },
]

/** The hard duty ceiling the controller keeps, above whatever Refloat pushes back at. */
export const DUTY_MOTOR_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'l_max_duty', label: 'Controller duty limit', format: percent },
]

/**
 * ERPM rather than km/h: the controller knows nothing about wheel size or gearing here, and
 * converting would invent a speed the board never actually limits to.
 */
export const SPEED_MOTOR_CONFIG_ROWS: BoardConfigRow[] = [
  { id: 'l_max_erpm', label: 'Forward ERPM limit', format: erpm },
  { id: 'l_min_erpm', label: 'Reverse ERPM limit', format: erpm },
]

/** MCCONF voltages are pack-level, where two decimals is noise. */
function voltage(value: number | boolean | undefined): string {
  return typeof value === 'number' ? `${value.toFixed(1)} V` : '—'
}
