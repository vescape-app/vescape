#!/usr/bin/env bun
import { listAdbDevices, pickDevice } from './lib/devices.ts'

const args = process.argv.slice(2)

const deviceFlag = args.findIndex((arg) => arg === '--device' || arg === '-d')
const requested = deviceFlag === -1 ? null : (args[deviceFlag + 1] ?? null)
if (deviceFlag !== -1) {
  if (!requested) {
    console.error('--device needs a name or serial')
    process.exit(1)
  }
  args.splice(deviceFlag, 2)
}

const LAST_PHONE_KEY = 'android-device'

const phone = await pickDevice({
  title: 'Android device',
  items: listAdbDevices().filter((device) => !device.isWatch),
  id: (device) => device.hardware,
  label: (device) => device.name,
  aliases: (device) => [device.serial, device.expoName],
  hint: (device) => (device.isEmulator ? 'emulator' : device.serial),
  requested,
  cacheKey: LAST_PHONE_KEY,
  emptyMessage:
    'No Android phone attached (`adb devices` shows none). Start an emulator or plug one in.',
})

function run(command: string[]) {
  console.log(`\n> ${command.join(' ')}\n`)
  const result = Bun.spawnSync(command, {
    env: process.env,
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  })
  if (!result.success) process.exit(result.exitCode ?? 1)
}

run(['bun', 'run', 'native:sync', 'android'])
run(['bun', 'run', 'relay:reverse'])
process.env.REACT_NATIVE_PACKAGER_HOSTNAME = '127.0.0.1'
run(['bunx', 'expo', 'run:android', '--device', phone.expoName, ...args])
