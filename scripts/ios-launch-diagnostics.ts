#!/usr/bin/env bun
// Temporary hosted-only startup probe. Remove with ios-repack-diagnostics.yml.
import { mkdirSync, readFileSync } from 'fs'
import { resolve } from 'path'

import { applicationId } from '../src/config/appVariant.ts'
import { runOrDie } from './lib/captureDriver.ts'
import { createIosDriver } from './lib/iosCapture.ts'

if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'darwin') {
  throw new Error('This temporary diagnostic only runs on a hosted macOS Actions runner.')
}

const app = resolve(process.argv[2] ?? '.expo/smoke/vescape.app')
const output = resolve('.expo/ios-launch-diagnostics')
mkdirSync(output, { recursive: true })
const driver = await createIosDriver('iPhone 17', 'replay-thor301.jsonl', 'smoke')
await Bun.write(`${output}/device.txt`, `${driver.deviceId}\n`)
await runOrDie(['xcrun', 'dwarfdump', '--uuid', `${app}/vescape`], undefined, 30_000)
await driver.requireAwakeDisplay()
await driver.installArtifact(app)
await driver.stageFixtures()
await driver.pinLocation()

const logPath = `${output}/simulator.log`
const log = Bun.spawn(
  [
    'xcrun',
    'simctl',
    'spawn',
    driver.deviceId,
    'log',
    'stream',
    '--style',
    'compact',
    '--level',
    'debug',
    '--predicate',
    'process == "vescape" OR eventMessage CONTAINS[c] "vescape"',
  ],
  { stdout: Bun.file(logPath), stderr: Bun.file(`${output}/log-stream-stderr.txt`) },
)

try {
  console.log(`Startup probe begins ${new Date().toISOString()}`)
  await runOrDie(
    [
      'maestro',
      'test',
      '--device',
      driver.deviceId,
      '-e',
      `APP_ID=${applicationId}`,
      '-e',
      `PROBE_KIND=${process.env.PROBE_KIND ?? 'unknown'}`,
      'e2e/flows/diagnostics/_ios-launch.yaml',
    ],
    { ...process.env, MAESTRO_DRIVER_STARTUP_TIMEOUT: '300000' },
    15 * 60_000,
  )
} finally {
  // Give ReportCrash time to write the .ips before the workflow's always-run collection step.
  await Bun.sleep(10_000)
  log.kill('SIGTERM')
  await log.exited
  const fatalLines = readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => /vescape/i.test(line) && /SIG(?:SEGV|ABRT|BUS|ILL|TRAP)/.test(line))
  if (fatalLines.length > 0) {
    await Bun.write(`${output}/fatal-signals.txt`, fatalLines.join('\n'))
    throw new Error(`Vescape fatal signal detected (${fatalLines.length} log entries).`)
  }
  if (log.exitCode !== 0 && log.signalCode !== 'SIGTERM') {
    throw new Error(
      'Simulator log collection ended unexpectedly; diagnostic evidence is incomplete.',
    )
  }
}
