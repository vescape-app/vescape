import { resolve } from 'path'
import { pathToFileURL } from 'url'
import { E2E_ACCOUNTS } from './groupRideAccounts.ts'

const root = resolve(process.env.GROUP_RIDE_SERVER_DIR ?? '../vescape-server')
const source = (path: string) => import(pathToFileURL(resolve(root, path)).href)
const { Elysia } = await import(Bun.resolveSync('elysia', root))
const { groupRideRelay } = await source('src/groupRide/relay.ts')
const { MemoryStore } = await source('src/groupRide/store.ts')
const { discardedRideHistory, discardedRideStore } = await source('src/groupRide/testing.ts')
const { bearerToken } = await source('src/auth/gate.ts')
const { appStatusRoutes } = await source('src/appStatus/routes.ts')
const { enforceOnlineCapability } = await source('src/appStatus/gate.ts')
const { appStatusConfig } = await source('src/appStatus/config.ts')

const accountOf = (request: Request) => {
  const token = bearerToken(request)
  return E2E_ACCOUNTS.find((account) => account.token === token) ?? null
}
const authed =
  (body: (account: (typeof E2E_ACCOUNTS)[number]) => unknown) =>
  ({ request }: { request: Request }) => {
    const account = accountOf(request)
    return account ? Response.json(body(account)) : new Response('Unauthorized', { status: 401 })
  }

const app = new Elysia()
  .onBeforeHandle(({ request }: { request: Request }) =>
    enforceOnlineCapability(request, appStatusConfig),
  )
  .get('/health', () => 'ok')
  .use(appStatusRoutes())
  .get(
    '/api/account',
    authed((account) => ({ id: account.id, createdAt: new Date(0).toISOString() })),
  )
  .get(
    '/api/rider-profile',
    authed((account) => ({
      profile: { accountId: account.id, nick: account.nick, nationality: null },
    })),
  )
  .get(
    '/api/friends',
    authed(() => ({ friends: [], incoming: [], outgoing: [] })),
  )
  .put('/api/rider-stats/:month', ({ request }: { request: Request }) =>
    accountOf(request) ? new Response(null, { status: 204 }) : new Response(null, { status: 401 }),
  )
  .use(
    groupRideRelay({
      store: new MemoryStore(),
      history: discardedRideHistory,
      rideStore: discardedRideStore,
      resolveAccount: async (request: Request) => accountOf(request)?.id ?? null,
      findNick: async (id: string) =>
        E2E_ACCOUNTS.find((account) => account.id === id)?.nick ?? null,
      findFriends: async () => new Set<string>(),
    }),
  )
  .listen({ hostname: '127.0.0.1', port: Number(process.env.GROUP_RIDE_PORT) })
console.log(`Group Ride relay listening on ${app.server.port}`)
const stop = async () => {
  await app.stop(true)
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
