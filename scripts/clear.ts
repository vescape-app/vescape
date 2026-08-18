import { readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { applicationId } from '../src/config/appVariant.ts'
import { listAdbDevices } from './lib/devices.ts'

const ROOT = join(import.meta.dir, '..')

const projectCaches = [
  '.expo',
  'android/.gradle',
  'android/build',
  'android/app/build',
  'node_modules/.cache',
]

const temporaryCachePrefixes = ['metro-', 'haste-map-', 'react-', 'hermes-']
const temporaryCacheNames = new Set(['metro-cache'])

function remove(path: string) {
  rmSync(path, { force: true, recursive: true })
  console.log(`removed ${path}`)
}

function run(command: string[]) {
  console.log(`\n> ${command.join(' ')}`)
  const result = Bun.spawnSync(command, {
    cwd: ROOT,
    env: process.env,
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  })

  if (result.exitCode !== 0) {
    process.exit(result.exitCode)
  }
}

function capture(command: string[]): string {
  const result = Bun.spawnSync(command, { cwd: ROOT, env: process.env })
  return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim() : ''
}

console.log('Clearing project caches...')
for (const path of projectCaches) {
  remove(join(ROOT, path))
}

console.log('\nClearing temporary Metro and Hermes caches...')
for (const name of readdirSync(tmpdir())) {
  if (
    temporaryCacheNames.has(name) ||
    temporaryCachePrefixes.some((prefix) => name.startsWith(prefix))
  ) {
    remove(join(tmpdir(), name))
  }
}

run(['./android/gradlew', '-p', 'android', '--stop'])
run(['./android/gradlew', '-p', 'android', 'clean'])

console.log('\nRepairing Android development tunnels...')
run(['bun', 'run', 'relay:reverse'])

if (
  capture(['curl', '-fsS', '--max-time', '1', 'http://127.0.0.1:8081/status']) ===
  'packager-status:running'
) {
  for (const device of listAdbDevices().filter((candidate) => !candidate.isWatch)) {
    const installed = capture([
      'adb',
      '-s',
      device.serial,
      'shell',
      'pm',
      'list',
      'packages',
      applicationId,
    ]).includes(`package:${applicationId}`)
    if (!installed) continue

    run([
      'adb',
      '-s',
      device.serial,
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      'vescape://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081',
      applicationId,
    ])
  }
}
