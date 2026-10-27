export async function adb(serial: string, ...args: string[]): Promise<Uint8Array> {
  const command = ['adb', '-s', serial, ...args]
  const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe', timeout: 20_000 })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).bytes(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`${command.join(' ')} failed (${code}): ${stderr.trim()}`)
  return stdout
}

/** UI Automator's visible app nodes, excluding foreign windows and zero-size placeholders. */
export function appNodes(xml: string, packageName: string): Record<string, string>[] {
  const nodes: Record<string, string>[] = []
  for (const [node] of xml.matchAll(/<node\b[^>]*>/g)) {
    const attrs = Object.fromEntries(
      [...node.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    )
    const bounds = attrs.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)
    if (
      attrs.package !== packageName ||
      !bounds ||
      +bounds[3] <= +bounds[1] ||
      +bounds[4] <= +bounds[2]
    )
      continue
    nodes.push(attrs)
  }
  return nodes
}

/** Remove the previous dump first, so a failed UI Automator invocation cannot reuse it. */
export async function appUi(serial: string, packageName: string) {
  const path = '/data/local/tmp/vescape-e2e.xml'
  await adb(serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
  await adb(serial, 'shell', 'rm', '-f', path)
  await adb(serial, 'shell', 'uiautomator', 'dump', '--compressed', path)
  const xml = new TextDecoder().decode(await adb(serial, 'exec-out', 'cat', path))
  return {
    xml,
    labels: appNodes(xml, packageName).flatMap((node) => [
      node.text ?? '',
      node['content-desc'] ?? '',
    ]),
  }
}

/** Release only this run's device-side listeners; host ports alone do not describe ownership. */
export async function removeReversePorts(serial: string, ports: readonly number[], command = adb) {
  const owned = new Set(ports.map((port) => `tcp:${port}`))
  const reverses = new TextDecoder().decode(await command(serial, 'reverse', '--list'))
  for (const line of reverses.trim().split('\n')) {
    const [, devicePort] = line.trim().split(/\s+/)
    if (owned.has(devicePort)) await command(serial, 'reverse', '--remove', devicePort)
  }
}
