import { unit, type BoardConfigRow } from '@/modules/board/components/BoardConfigSection'

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
