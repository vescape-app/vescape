/**
 * A sensor frame as the board pushes it: a flat JSON object of numbers, one key per reading.
 * Unknown keys are kept, so a newly wired sensor shows up without an app release.
 *
 * @parity ../vescape-hardware/src/main.cpp `sensorFrame`
 */
export interface SensorFrame {
  atMs: number
  values: Record<string, number>
}

/**
 * Reads a device notification as a sensor frame, or returns null when it is anything else
 * (echoes, boot chatter, a half-delivered write). Console lines stay the fallback.
 */
export function parseSensorFrame(text: string, atMs: number): SensorFrame | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const values: Record<string, number> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'number' && Number.isFinite(value)) values[key] = value
  }
  return Object.keys(values).length > 0 ? { atMs, values } : null
}
