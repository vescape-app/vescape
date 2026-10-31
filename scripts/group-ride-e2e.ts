/** Real local relay → native phone presence → Social UI → Wear Data Layer → wrist roster. */
import { mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { applicationId } from '../src/config/appVariant.ts'
import { listAdbDevices } from './lib/devices.ts'
import { pickAvd } from './lib/avds.ts'
import { E2eSession } from './lib/e2eSession.ts'
import { maestroCommand } from './lib/maestro.ts'
import { adb, appNodes, appUi } from './lib/androidUiE2e.ts'
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
let peer: GroupRidePeer | undefined
let gpsTimer: ReturnType<typeof setInterval> | undefined
const session = new E2eSession(process.env)
const env = session.env
const start = (command: string[], log?: string) =>
  session.start(command, log ? join(artifacts, log) : undefined)
const run = (command: string[], timeout?: number) => session.run(command, timeout)
const interrupt = () => session.abort.abort(new Error('Group Ride E2E interrupted'))
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)
try {
  await maestroCommand()
  const phoneAvd = await pickAvd(false, requested[1] ?? null)
  const watchAvd = await pickAvd(true, process.env.WEAR_AVD ?? null)
  env.WEAR_AVD = watchAvd.name
  const serverRoot = resolve(
    process.env.GROUP_RIDE_SERVER_DIR ?? join(ROOT, '..', 'vescape-server'),
  )
  env.GROUP_RIDE_SERVER_DIR = serverRoot
  const revision = Bun.spawnSync(['git', '-C', serverRoot, 'rev-parse', 'HEAD'])
  if (!revision.success) throw new Error(`Missing server checkout: ${serverRoot}`)
  await Bun.write(join(artifacts, 'server-revision.txt'), revision.stdout)
  const relayPort = await session.port()
  env.GROUP_RIDE_PORT = String(relayPort)
  env.EXPO_PUBLIC_SERVER_URL = `http://127.0.0.1:${relayPort}`
  const metroPort = await session.port()
  env.E2E_METRO_PORT = String(metroPort)
  const relay = start(['bun', 'run', 'scripts/lib/groupRideRelayHost.ts'], 'relay.log')
  await session.ready(`${env.EXPO_PUBLIC_SERVER_URL}/health`, relay)
  peer = new GroupRidePeer(`ws://127.0.0.1:${relayPort}/ws/group-rides`, version)
  await peer.start()
  console.log('group E2E: real local relay and peer ready')
  const metro = start(
    ['bunx', 'expo', 'start', '--host', 'lan', '--clear', '--port', env.E2E_METRO_PORT],
    'metro.log',
  )
  await session.ready(`http://127.0.0.1:${env.E2E_METRO_PORT}/status`, metro)
  await run([
    'bun',
    'run',
    'scripts/wear.ts',
    'up',
    '--rebuild-phone',
    '--clear-phone',
    '--device',
    phoneAvd.name,
  ])
  const devices = listAdbDevices()
  const phone = devices.find((d) => !d.isWatch && d.name === phoneAvd.name)
  const watch = devices.find((d) => d.isWatch && d.name === watchAvd.name)
  if (!phone || !watch) throw new Error('Selected phone and Wear emulators are not connected')
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
  const swipeUp = async () => {
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
  const watchCheck = async (name: string, battery: string | null) => {
    const deadline = Date.now() + 60_000
    let lastError = ''
    let leftObservations = 0
    while (Date.now() < deadline) {
      session.abort.signal.throwIfAborted()
      try {
        if (battery === null) {
          // Ambient returns to gauges. Deliberately visit the last page before asserting removal.
          await adb(watch.serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
          await swipeUp()
          await swipeUp()
        }
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
        const left =
          appNodes(snapshot.xml, applicationId).length > 0 &&
          !snapshot.labels.some((label) => /^Group · \d+$/.test(label)) &&
          !snapshot.labels.includes('Peer') &&
          !snapshot.labels.includes('Waiting for riders')
        leftObservations = left ? leftObservations + 1 : 0
        if (
          battery === null
            ? leftObservations >= 3
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
          await swipeUp()
        }
      } catch (error) {
        leftObservations = 0
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
  if (!(
    initialDistance > 0 &&
    updatedDistance > initialDistance * 2.5 &&
    updatedDistance < initialDistance * 3.5
  )) {
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
  if (peer) {
    await Bun.write(join(artifacts, 'peer.json'), JSON.stringify(peer.transcript, null, 2))
    peer.close()
  }
  try {
    await session.close()
  } catch (error) {
    process.exitCode = 1
    console.error('Group Ride E2E cleanup failed:', error)
  }
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
  console.log(`Group Ride E2E artifacts: ${artifacts}`)
}
