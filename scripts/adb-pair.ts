/**
 * Pairs an Android 11+ phone for wireless debugging by QR code, like Android Studio's
 * "Pair devices using Wi-Fi". The phone scans the code, advertises itself over mDNS,
 * and adb pairs with the advertised address. Phone and computer must share a network with mDNS.
 */
import { randomBytes } from 'node:crypto'
import qrcode from 'qrcode-terminal'

const TIMEOUT_MS = 120_000

async function adb(...args: string[]): Promise<string> {
  const proc = Bun.spawn(['adb', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  if (code !== 0)
    throw new Error(`adb ${args.join(' ')} failed: ${await new Response(proc.stderr).text()}`)
  return out
}

async function pairingAddress(name: string): Promise<string | null> {
  const line = (await adb('mdns', 'services'))
    .split('\n')
    .find((l) => l.includes(name) && l.includes('_adb-tls-pairing'))
  return line?.match(/\d+\.\d+\.\d+\.\d+:\d+/)?.[0] ?? null
}

const name = `adb-vescape-${randomBytes(3).toString('hex')}`
const password = randomBytes(4).toString('hex')

qrcode.generate(`WIFI:T:ADB;S:${name};P:${password};;`, { small: true })
console.log('Phone: Developer options → Wireless debugging → Pair device with QR code')
console.log('Waiting for phone...')

const deadline = Date.now() + TIMEOUT_MS
while (Date.now() < deadline) {
  const address = await pairingAddress(name)
  if (address) {
    console.log(await adb('pair', address, password))
    await Bun.sleep(2000)
    console.log(await adb('devices'))
    process.exit(0)
  }
  await Bun.sleep(1000)
}
console.error('Timed out. Is the phone on the same network, and does it allow mDNS?')
process.exit(1)
