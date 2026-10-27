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
  // UI Automator emits each node's attributes on one tag. Only numeric, entity-free labels
  // are read here; this is not a general XML parser.
  for (const [node] of xml.matchAll(/<node\b[^>]*>/g)) {
    const attrs = Object.fromEntries(
      [...node.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
    )
    if (attrs.package !== packageName) continue
    const bounds = attrs.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)
    if (!bounds || Number(bounds[3]) <= Number(bounds[1]) || Number(bounds[4]) <= Number(bounds[2]))
      continue
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

async function adb(serial: string, ...args: string[]): Promise<Uint8Array> {
  const command = ['adb', '-s', serial, ...args]
  const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe', timeout: 20_000 })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).bytes(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`${command.join(' ')} failed (${code}): ${stderr.trim()}`)
  return stdout
}

/** Real-device UI assertions, independent of Maestro's phone-only device discovery. */
export async function verifyWatchTelemetry(serial: string, packageName: string, artifacts: string) {
  mkdirSync(artifacts, { recursive: true })
  const check = new WatchTelemetryCheck()
  const dump = '/data/local/tmp/vescape-watch-e2e.xml'
  const deadline = Date.now() + 90_000
  let lastError = 'No UI snapshot received'
  try {
    while (Date.now() < deadline) {
      // Waking keeps the readouts visible without changing the user's screen-timeout settings.
      await adb(serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
      await adb(serial, 'shell', 'rm', '-f', dump)
      try {
        await adb(serial, 'shell', 'uiautomator', 'dump', '--compressed', dump)
        const xml = new TextDecoder().decode(await adb(serial, 'exec-out', 'cat', dump))
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
