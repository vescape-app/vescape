import { expect, test } from 'bun:test'
import { withE2eSession, type SessionIO } from './e2eSession.ts'

test('a thrown flow error stops the owned server and removes both device listeners, preserving other tunnels', async () => {
  const mappings = new Map(['phone', 'watch'].map((serial) => [serial, new Set(['tcp:8081'])]))
  const io: SessionIO = {
    devices: () => [...mappings.keys()].map((serial) => ({ serial })),
    adb: async (serial, ...args) => {
      const ports = mappings.get(serial)!
      if (args[1] === '--list')
        return new TextEncoder().encode([...ports].map((port) => `host ${port} ${port}`).join('\n'))
      expect(args[1]).toBe('--remove')
      expect(ports.delete(args[2])).toBe(true)
      return new Uint8Array()
    },
  }
  let child: Bun.Subprocess | undefined
  let port = 0
  await expect(
    withE2eSession(
      async (session) => {
        port = await session.port()
        for (const ports of mappings.values()) ports.add(`tcp:${port}`)
        session.env.TEST_PORT = String(port)
        child = session.start([
          process.execPath,
          '-e',
          'Bun.serve({port:Number(process.env.TEST_PORT),fetch:()=>new Response()});',
        ])
        await session.ready(`http://127.0.0.1:${port}`, child, 5000)
        expect((await fetch(`http://127.0.0.1:${port}`)).ok).toBe(true)
        throw new Error('flow assertion failed')
      },
      { ...process.env },
      io,
    ),
  ).rejects.toThrow('flow assertion failed')
  expect(child!.signalCode).toBe('SIGTERM')
  for (const ports of mappings.values()) expect([...ports]).toEqual(['tcp:8081'])
  await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow()
})

test('cancellation stops a running command and fixture flags cannot leak across suites', async () => {
  const io: SessionIO = { devices: () => [], adb: async () => new Uint8Array() }
  await expect(
    withE2eSession(
      async (session) => {
        expect(session.env.EXPO_PUBLIC_E2E).toBe('0')
        expect(session.env.EXPO_PUBLIC_SMOKE).toBe('0')
        expect(session.env.SENTRY_DISABLE_AUTO_UPLOAD).toBe('true')
        const timer = setTimeout(() => session.abort.abort(new Error('cancelled')), 100)
        try {
          await session.run([process.execPath, '-e', 'setInterval(()=>{},1000)'])
        } finally {
          clearTimeout(timer)
        }
      },
      { ...process.env, EXPO_PUBLIC_E2E: '1', EXPO_PUBLIC_SMOKE: '1' },
      io,
    ),
  ).rejects.toThrow('cancelled')
})
