/**
 * Tunnels the device's localhost ports to this machine. Metro always uses 8081; the Vescape API
 * port is added when `EXPO_PUBLIC_SERVER_URL` points at a local server (../vescape-server).
 * Safe to run repeatedly before `expo run:android` or after clearing local development state.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

function localPort(serverUrl: string | undefined): number | null {
  if (!serverUrl) return null
  let url: URL
  try {
    url = new URL(serverUrl)
  } catch {
    return null
  }
  if (!LOCAL_HOSTS.has(url.hostname)) return null
  return Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
}

async function adb(...args: string[]): Promise<string> {
  const proc = Bun.spawn(['adb', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  if (code !== 0)
    throw new Error(`adb ${args.join(' ')} failed: ${await new Response(proc.stderr).text()}`)
  return out
}

async function connectedDevices(): Promise<string[]> {
  return (await adb('devices'))
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t'))
    .filter(([, state]) => state?.trim() === 'device')
    .map(([serial]) => serial!)
}

const ports = new Set([8081])
const serverPort = localPort(process.env.EXPO_PUBLIC_SERVER_URL)
if (serverPort !== null) ports.add(serverPort)

let devices: string[]
try {
  devices = await connectedDevices()
} catch (error) {
  console.warn(`Skipping relay reverse: ${error instanceof Error ? error.message : error}`)
  process.exit(0)
}

for (const serial of devices) {
  for (const port of ports) {
    await adb('-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`)
    console.log(`Reversed ${serial} localhost:${port} -> host:${port}`)
  }
}
