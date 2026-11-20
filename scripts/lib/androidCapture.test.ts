import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

function runPreview(device: string, watchRunning = false) {
  const directory = mkdtempSync(join(tmpdir(), 'android-capture-test-'))
  try {
    const avdHome = join(directory, 'avd')
    for (const [name, tag] of [
      ['TestPhone', 'google_apis'],
      ['TestWatch', 'android-wear'],
    ]) {
      const avd = join(avdHome, `${name}.avd`)
      mkdirSync(avd, { recursive: true })
      writeFileSync(join(avd, 'config.ini'), `tag.id=${tag}\n`)
    }

    mkdirSync(join(directory, 'emulator'))
    writeFileSync(
      join(directory, 'emulator', 'emulator'),
      `#!/bin/sh
case "$1" in
  -list-avds) printf 'TestPhone\nTestWatch\n' ;;
  -avd) touch "$CAPTURE_FIXTURE/booted" ;;
esac
`,
      { mode: 0o755 },
    )
    writeFileSync(
      join(directory, 'adb'),
      `#!/bin/sh
case "$*" in
  devices*)
    printf 'List of devices attached\n'
    if [ -f "$CAPTURE_FIXTURE/booted" ] || [ "$CAPTURE_WATCH_RUNNING" = 1 ]; then
      printf 'emulator-5556\tdevice model:Watch\n'
    fi
    if [ -f "$CAPTURE_FIXTURE/booted" ]; then
      printf 'emulator-5554\tdevice model:Phone\n'
    fi ;;
  '-s emulator-5556 emu avd name') printf 'TestWatch\nOK\n' ;;
  '-s emulator-5554 emu avd name') printf 'TestPhone\nOK\n' ;;
  '-s emulator-5556 shell getprop') printf '[ro.build.characteristics]: [watch]\n' ;;
  *'sys.boot_completed') printf '1\n' ;;
esac
`,
      { mode: 0o755 },
    )

    const result = Bun.spawnSync(
      [
        process.execPath,
        join(import.meta.dir, '../preview.ts'),
        '--platform',
        'android',
        '--device',
        device,
        '--no-build',
      ],
      {
        env: {
          ...process.env,
          ANDROID_HOME: directory,
          ANDROID_AVD_HOME: avdHome,
          PATH: `${directory}:${process.env.PATH}`,
          CAPTURE_FIXTURE: directory,
          CAPTURE_WATCH_RUNNING: watchRunning ? '1' : '0',
        },
        timeout: 4000,
      },
    )
    expect(result.exitCode).toBe(1)
    return `${result.stdout.toString()}\n${result.stderr.toString()}`
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('rejects a powered-off Wear AVD as a phone target', () => {
  expect(runPreview('TestWatch')).toContain('no device matches "TestWatch"')
})

test('rejects a running Wear AVD as a phone target', () => {
  expect(runPreview('TestWatch', true)).toContain('no device matches "TestWatch"')
})

test('selects the named phone when both emulators appear during boot', () => {
  const output = runPreview('TestPhone')
  expect(output).toContain('TestPhone (emulator-5554)')
  expect(output).toContain('is not installed on TestPhone')
})
