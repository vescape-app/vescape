import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const fixtures: string[] = []

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function runEmulator(lock?: string) {
  const directory = mkdtempSync(join(tmpdir(), 'android-emulator-test-'))
  fixtures.push(directory)
  const avdHome = join(directory, 'avd')
  const avd = join(avdHome, 'Test_Phone.avd')
  mkdirSync(avd, { recursive: true })
  mkdirSync(join(directory, 'emulator'))
  if (lock !== undefined) writeFileSync(join(avd, 'hardware-qemu.ini.lock'), lock)
  const marker = join(directory, 'launched')
  writeFileSync(
    join(directory, 'emulator', 'emulator'),
    '#!/bin/sh\nif [ "$1" = "-list-avds" ]; then echo Test_Phone; exit 0; fi\nsleep 0.2\nprintf "%s\\n" "$@" > "$EMULATOR_TEST_MARKER"\n',
    { mode: 0o755 },
  )
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, 'android-emulator.ts'), '--device', 'Test_Phone'],
    {
      env: {
        ...process.env,
        ANDROID_HOME: directory,
        ANDROID_AVD_HOME: avdHome,
        EMULATOR_TEST_MARKER: marker,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const output = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  return { output, marker }
}

test('launches past a stale lock left by an exited process', async () => {
  const owner = Bun.spawn([process.execPath, '-e', ''], { stdout: 'ignore', stderr: 'ignore' })
  await owner.exited
  const { output, marker } = await runEmulator(`${owner.pid}\0`)
  expect(output).toContain('booting Test_Phone')
  await Bun.sleep(500)
  expect(readFileSync(marker, 'utf8')).toBe('-avd\nTest_Phone\n')
})

test('does not launch a duplicate while the lock owner is alive, even without adb', async () => {
  const { output } = await runEmulator(`${process.pid}\0`)
  expect(output).toContain('Test_Phone is already running')
})

test('launches without a lock and survives the launcher exiting', async () => {
  const { output, marker } = await runEmulator()
  expect(output).toContain('booting Test_Phone')
  await Bun.sleep(500)
  expect(readFileSync(marker, 'utf8')).toBe('-avd\nTest_Phone\n')
})
