import { withE2eSession } from './lib/e2eSession.ts'

// Normal native mode, served by this run's Metro. No pre-existing dev server is required.
await withE2eSession(async (session) => {
  const port = await session.port()
  session.env.E2E_METRO_PORT = String(port)
  const metro = session.start([
    'bunx',
    'expo',
    'start',
    '--host',
    'lan',
    '--clear',
    '--port',
    String(port),
  ])
  await session.ready(`http://127.0.0.1:${port}/status`, metro)
  await session.run(['bun', 'run', 'scripts/wear.ts', 'e2e', ...Bun.argv.slice(2)])
})
