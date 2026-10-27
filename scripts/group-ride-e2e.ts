/** Real local relay → native phone presence → Social UI → Wear Data Layer → wrist roster. */
import { mkdirSync, openSync, closeSync } from 'fs'
import { join, resolve } from 'path'
import { applicationId } from '../src/config/appVariant.ts'
import { listAdbDevices } from './lib/devices.ts'
import { maestroCommand } from './lib/maestro.ts'
import { adb, appUi, removeReversePorts } from './lib/androidUiE2e.ts'
import { GroupRidePeer, PHONE_FIX } from './lib/groupRidePeer.ts'
import { version } from '../package.json'

const ROOT = resolve(import.meta.dir, '..')
const args = Bun.argv.slice(2)
const flag = args.indexOf('--device')
const requested = flag < 0 ? [] : ['--device', args[flag + 1]]
if (flag >= 0 && !args[flag + 1]) throw new Error('--device requires a phone AVD name or serial')
const artifacts = join(
  ROOT,
  '.expo',
  'group-ride-e2e',
  new Date().toISOString().replaceAll(':', '-'),
)
mkdirSync(artifacts, { recursive: true })
const children: Bun.Subprocess[] = []
const reversePorts: number[] = []
let peer: GroupRidePeer | undefined
let interrupted = false
let gpsTimer: ReturnType<typeof setInterval> | undefined
const env: NodeJS.ProcessEnv = {
  ...process.env,
  REACT_NATIVE_PACKAGER_HOSTNAME: '127.0.0.1',
  EXPO_NO_DOTENV: '1',
}
// This suite exercises native. A caller's fake/smoke env must never silently change that boundary.
for (const flag of [
  'EXPO_PUBLIC_E2E',
  'EXPO_PUBLIC_SMOKE',
  'EXPO_PUBLIC_PREVIEW',
  'EXPO_PUBLIC_SCREENSHOTS',
])
  env[flag] = '0'
function freePort() {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = server.port!
  server.stop(true)
  return port
}
function start(command: string[], log?: string) {
  if (interrupted) throw new Error('Group Ride E2E interrupted')
  const fd = log ? openSync(join(artifacts, log), 'w') : undefined
  const child = Bun.spawn(command, {
    cwd: ROOT,
    env,
    detached: true,
    stdout: fd ?? 'inherit',
    stderr: fd ?? 'inherit',
  })
  if (fd !== undefined) closeSync(fd)
  children.push(child)
  return child
}
async function run(command: string[], timeout = 30 * 60_000) {
  const child = start(command)
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      /* exited at the deadline */
    }
  }, timeout)
  try {
    if ((await child.exited) !== 0) throw new Error(`Failed: ${command.join(' ')}`)
  } finally {
    clearTimeout(timer)
  }
}
async function ready(url: string, child: Bun.Subprocess) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Server exited before ready: ${url}. See ${artifacts}`)
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return
    } catch {
      /* starting */
    }
    await Bun.sleep(300)
  }
  throw new Error(`Server did not become ready: ${url}`)
}
const interrupt = () => {
  interrupted = true
  peer?.close()
  for (const child of children) child.kill('SIGTERM')
}
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)
try {
  await maestroCommand()
  const serverRoot = resolve(
    process.env.GROUP_RIDE_SERVER_DIR ?? join(ROOT, '..', 'vescape-server'),
  )
  env.GROUP_RIDE_SERVER_DIR = serverRoot
  const revision = Bun.spawnSync(['git', '-C', serverRoot, 'rev-parse', 'HEAD'])
  if (!revision.success) throw new Error(`Missing server checkout: ${serverRoot}`)
  await Bun.write(join(artifacts, 'server-revision.txt'), revision.stdout)
  const relayPort = freePort()
  reversePorts.push(relayPort)
  env.GROUP_RIDE_PORT = String(relayPort)
  env.EXPO_PUBLIC_SERVER_URL = `http://127.0.0.1:${relayPort}`
  const metroPort = freePort()
  reversePorts.push(metroPort)
  env.E2E_METRO_PORT = String(metroPort)
  const relay = start(['bun', 'run', 'scripts/lib/groupRideRelayHost.ts'], 'relay.log')
  await ready(`${env.EXPO_PUBLIC_SERVER_URL}/health`, relay)
  peer = new GroupRidePeer(`ws://127.0.0.1:${relayPort}/ws/group-rides`, version)
  await peer.start()
  console.log('group E2E: real local relay and peer ready')
  const metro = start(
    ['bunx', 'expo', 'start', '--host', 'lan', '--clear', '--port', env.E2E_METRO_PORT],
    'metro.log',
  )
  await ready(`http://127.0.0.1:${env.E2E_METRO_PORT}/status`, metro)
  await run([
    'bun',
    'run',
    'scripts/wear.ts',
    'up',
    '--rebuild-phone',
    '--clear-phone',
    ...requested,
  ])
  const devices = listAdbDevices()
  const phone = devices.find((d) => !d.isWatch && d.isEmulator)
  const watch = devices.find((d) => d.isWatch && d.isEmulator)
  if (!phone || !watch) throw new Error('Phone and Wear emulators required')
  // Use the pair selected by wear, rather than silently taking another attached phone.
  if (
    devices.filter((d) => !d.isWatch && d.isEmulator).length !== 1 ||
    devices.filter((d) => d.isWatch && d.isEmulator).length !== 1
  )
    throw new Error('Run with exactly one phone and one Wear emulator')
  const gpsFix = () =>
    adb(phone.serial, 'emu', 'geo', 'fix', String(PHONE_FIX.lng), String(PHONE_FIX.lat))
  await gpsFix()
  // Keep fixes arriving while clearState cold-starts the app and reopens native GPS.
  gpsTimer = setInterval(() => {
    void gpsFix().catch((error) => console.warn('Emulator GPS:', error))
  }, 3000)
  const flow = async (name: string) =>
    run(
      await maestroCommand(
        '--device',
        phone.serial,
        'test',
        '--test-output-dir',
        join(artifacts, name),
        '-e',
        `APP_ID=${applicationId}`,
        '-e',
        `METRO_PORT=${env.E2E_METRO_PORT}`,
        `e2e/group-ride/${name}.yaml`,
      ),
      5 * 60_000,
    )
  const watchCheck = async (name: string, battery: string | null) => {
    const deadline = Date.now() + 60_000
    let lastError = ''
    while (Date.now() < deadline) {
      if (interrupted) throw new Error('Group Ride E2E interrupted')
      try {
        const snapshot = await appUi(watch.serial, applicationId)
        await Bun.write(join(artifacts, `watch-${name}.xml`), snapshot.xml)
        const foreground = new TextDecoder().decode(
          await adb(watch.serial, 'shell', 'dumpsys', 'activity', 'activities'),
        )
        if (
          !foreground
            .split('\n')
            .some(
              (line) =>
                /resumedactivity[:=]/i.test(line) &&
                line.includes(`${applicationId}/app.vescape.wear.MainActivity`),
            )
        )
          throw new Error('Watch app is not in the foreground')
        const groupVisible =
          snapshot.labels.includes('Peer') && snapshot.labels.includes('Group · 1')
        if (
          battery === null
            ? !snapshot.labels.includes('Peer') && !snapshot.labels.includes('Group · 1')
            : groupVisible && snapshot.labels.includes(battery)
        ) {
          await Bun.write(
            join(artifacts, `watch-${name}.png`),
            await adb(watch.serial, 'exec-out', 'screencap', '-p'),
          )
          const distance = snapshot.labels.find((label) => /^\d+m$/.test(label))
          if (battery !== null && !distance)
            throw new Error('Wrist roster has no displayed distance')
          console.log(`group E2E: wrist ${name} passed${distance ? `, distance ${distance}` : ''}`)
          return distance ? Number(distance.slice(0, -1)) : 0
        }
        // Gauges → navigation focus → group roster, through the actual pager gestures.
        if (battery !== null && !groupVisible) {
          const size = new TextDecoder()
            .decode(await adb(watch.serial, 'shell', 'wm', 'size'))
            .match(/(\d+)x(\d+)/)!
          await adb(
            watch.serial,
            'shell',
            'input',
            'swipe',
            String(+size[1] / 2),
            String(+size[2] * 0.8),
            String(+size[1] / 2),
            String(+size[2] * 0.2),
            '400',
          )
        }
      } catch (error) {
        lastError = String(error)
      }
      await Bun.sleep(1000)
    }
    throw new Error(
      `Watch ${name} failed: ${lastError || 'expected roster state was not displayed'}`,
    )
  }
  await flow('join')
  await peer.verifyPhone()
  console.log('group E2E: peer received phone GPS presence without a Board Session')
  const initialDistance = await watchCheck('joined', '12%')
  peer.update()
  await flow('update')
  const updatedDistance = await watchCheck('updated', '23%')
  // The peer moved from ~111 m to ~334 m north. The wrist must receive position, not just battery.
  if (
    !(
      initialDistance > 0 &&
      updatedDistance > initialDistance * 2.5 &&
      updatedDistance < initialDistance * 3.5
    )
  ) {
    throw new Error(`Wrist peer position did not update: ${initialDistance} → ${updatedDistance} m`)
  }
  await flow('leave')
  await peer.verifyLeft()
  await watchCheck('left', null)
  console.log(
    'Group Ride E2E passed: phone join/presence/update/leave + live Wear roster/update/removal',
  )
} catch (error) {
  process.exitCode = 1
  console.error(error)
} finally {
  clearInterval(gpsTimer)
  // adb reverse binds a listener on the device. Leaking one can make a later Maestro
  // driver fail to bind that port even though the old host server has already exited.
  try {
    const results = await Promise.allSettled(
      listAdbDevices().map((device) => removeReversePorts(device.serial, reversePorts)),
    )
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason))
  } catch (error) {
    process.exitCode = 1
    console.error('Group Ride E2E reverse cleanup failed:', error)
  }
  if (peer) {
    await Bun.write(join(artifacts, 'peer.json'), JSON.stringify(peer.transcript, null, 2))
    peer.close()
  }
  for (const child of children.reverse()) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.warn(error)
    }
  }
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
  console.log(`Group Ride E2E artifacts: ${artifacts}`)
}
