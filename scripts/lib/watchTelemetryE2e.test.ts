import { expect, test } from 'bun:test'
import { WatchTelemetryCheck } from './watchTelemetryE2e'

const packageName = 'app.vescape.dev'
function snapshot(speed: string, duty = 'Duty 36 %', pkg = packageName, bounds = '[0,0][100,100]') {
  return `<hierarchy><node package="${pkg}" content-desc="${speed}" bounds="${bounds}"/><node package="${pkg}" content-desc="${duty}" bounds="${bounds}"/></hierarchy>`
}

test('requires two live rendered snapshots with changing speed, not repeated cached frames', () => {
  const check = new WatchTelemetryCheck()
  expect(check.accept(snapshot('Speed 0 km/h'), packageName)).toBeNull()
  expect(check.accept(snapshot('Speed 20 km/h'), packageName)).toBeNull()
  expect(check.accept(snapshot('Speed 20 km/h'), packageName)).toBeNull()
  expect(check.accept(snapshot('Speed 21 km/h'), packageName)).toEqual({
    first: { speed: 20, unit: 'km/h', duty: 36 },
    current: { speed: 21, unit: 'km/h', duty: 36 },
  })
})

test('stale, missing, hidden, and foreign-app readouts cannot complete a live sequence', () => {
  for (const invalid of [
    snapshot('Stale Speed 21 km/h'),
    snapshot('Speed 21 km/h', 'Duty — %'),
    snapshot('Speed 21 km/h', 'Duty 36 %', 'other.app'),
    snapshot('Speed 21 km/h', 'Duty 36 %', packageName, '[0,0][0,0]'),
  ]) {
    const check = new WatchTelemetryCheck()
    check.accept(snapshot('Speed 20 km/h'), packageName)
    expect(check.accept(invalid, packageName)).toBeNull()
    // Losing live UI resets the sequence; a later reading needs a fresh pair.
    expect(check.accept(snapshot('Speed 22 km/h'), packageName)).toBeNull()
  }
})

test('a settings conversion alone cannot masquerade as moving telemetry', () => {
  const check = new WatchTelemetryCheck()
  check.accept(snapshot('Speed 20 km/h'), packageName)
  expect(check.accept(snapshot('Speed 12 mph'), packageName)).toBeNull()
  expect(check.accept(snapshot('Speed 13 mph'), packageName)).not.toBeNull()
})
