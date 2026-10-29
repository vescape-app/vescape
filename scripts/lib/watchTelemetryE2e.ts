import { adb, appNodes, appUi } from './androidUiE2e.ts'
import { mkdirSync } from 'fs'
import { join } from 'path'

interface Readouts {
  speed: number
  unit: string
  duty: number
}

/** Only visible, live readouts in our app count; stale labels and dash placeholders do not. */
function readouts(xml: string, packageName: string): Readouts | null {
  let speed: number | undefined
  let unit = ''
  let duty: number | undefined
  for (const attrs of appNodes(xml, packageName)) {
    const speedMatch = attrs['content-desc']?.match(/^Speed (\d+) (km\/h|mph)$/)
    const dutyMatch = attrs['content-desc']?.match(/^Duty (\d+) %$/)
    if (speedMatch) {
      speed = Number(speedMatch[1])
      unit = speedMatch[2]
    }
    if (dutyMatch) duty = Number(dutyMatch[1])
  }
  return speed === undefined || duty === undefined || duty > 100 ? null : { speed, unit, duty }
}

/** A cached frame cannot pass. Both snapshots must contain live speed + duty in the same units. */
export class WatchTelemetryCheck {
  private first: Readouts | null = null

  accept(xml: string, packageName: string): { first: Readouts; current: Readouts } | null {
    const current = readouts(xml, packageName)
    if (!current) {
      this.first = null
      return null
    }
    if (!this.first || this.first.unit !== current.unit) {
      this.first = current.speed > 0 ? current : null
      return null
    }
    return current.speed !== this.first.speed ? { first: this.first, current } : null
  }
}

/** Real-device UI assertions, independent of Maestro's phone-only device discovery. */
export async function verifyWatchTelemetry(serial: string, packageName: string, artifacts: string) {
  mkdirSync(artifacts, { recursive: true })
  const check = new WatchTelemetryCheck()
  const deadline = Date.now() + 90_000
  let lastError = 'No UI snapshot received'
  try {
    while (Date.now() < deadline) {
      try {
        const { xml } = await appUi(serial, packageName)
        await Bun.write(join(artifacts, 'latest.xml'), xml)
        const result = check.accept(xml, packageName)
        if (result) {
          await Bun.write(join(artifacts, 'readouts.json'), JSON.stringify(result, null, 2))
          console.log(
            `wear: displayed speed ${result.first.speed} → ${result.current.speed} ${result.current.unit}, duty ${result.current.duty}%`,
          )
          return
        }
        lastError = 'Expected live speed and duty, followed by a displayed speed change'
      } catch (error) {
        lastError = String(error)
      }
      await Bun.sleep(1000)
    }
    throw new Error(`Watch telemetry UI did not update: ${lastError}. Artifacts: ${artifacts}`)
  } finally {
    // Best effort: a disconnected emulator must not replace the original assertion failure.
    try {
      await Bun.write(
        join(artifacts, 'watch.png'),
        await adb(serial, 'exec-out', 'screencap', '-p'),
      )
    } catch (error) {
      console.warn(`wear: screenshot unavailable: ${String(error)}`)
    }
    console.log(`wear: E2E artifacts: ${artifacts}`)
  }
}
