import { expect, test } from 'bun:test'
import { removeReversePorts } from './androidUiE2e.ts'

test('teardown releases owned reverse listeners on both devices while preserving unrelated tunnels', async () => {
  const tunnels = new Map([
    [
      'phone',
      new Map([
        ['tcp:8081', 'tcp:8081'],
        ['tcp:3000', 'tcp:3000'],
        ['tcp:61349', 'tcp:61349'],
        ['tcp:61350', 'tcp:61350'],
        ['tcp:9000', 'tcp:61350'],
      ]),
    ],
    [
      'watch',
      new Map([
        ['tcp:8081', 'tcp:8081'],
        ['tcp:61349', 'tcp:61349'],
      ]),
    ],
  ])
  const command = async (serial: string, ...args: string[]) => {
    const mappings = tunnels.get(serial)!
    expect(args[0]).toBe('reverse')
    if (args[1] === '--list')
      return new TextEncoder().encode(
        [...mappings].map(([device, host]) => `host-12 ${device} ${host}`).join('\n'),
      )
    expect(args[1]).toBe('--remove')
    expect(mappings.delete(args[2])).toBe(true)
    return new Uint8Array()
  }
  // The runner uses this same cleanup after a pass or a thrown flow error.
  for (const serial of tunnels.keys()) await removeReversePorts(serial, [61349, 61350], command)
  expect([...tunnels.get('phone')!]).toEqual([
    ['tcp:8081', 'tcp:8081'],
    ['tcp:3000', 'tcp:3000'],
    ['tcp:9000', 'tcp:61350'],
  ])
  expect([...tunnels.get('watch')!]).toEqual([['tcp:8081', 'tcp:8081']])
  // Repeated cleanup is safe when startup failed before installing either mapping.
  for (const serial of tunnels.keys()) await removeReversePorts(serial, [61349, 61350], command)
})
