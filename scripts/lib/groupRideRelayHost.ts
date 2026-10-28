/** Mount the sibling server's real relay, with ephemeral storage and no external services. */
import { resolve } from 'path'
import { pathToFileURL } from 'url'

const root = resolve(process.env.GROUP_RIDE_SERVER_DIR ?? '../vescape-server')
const source = (path: string) => import(pathToFileURL(resolve(root, path)).href)
const { Elysia } = await import(Bun.resolveSync('elysia', root))
const { groupRideRelay } = await source('src/groupRide/relay.ts')
const { MemoryStore } = await source('src/groupRide/store.ts')
const { appStatusRoutes } = await source('src/appStatus/routes.ts')
const { enforceOnlineCapability } = await source('src/appStatus/gate.ts')
const { appStatusConfig } = await source('src/appStatus/config.ts')
const app = new Elysia()
  .onBeforeHandle(({ request }: { request: Request }) =>
    enforceOnlineCapability(request, appStatusConfig),
  )
  .get('/health', () => 'ok')
  .use(appStatusRoutes())
  .use(groupRideRelay(new MemoryStore()))
  .listen({ hostname: '127.0.0.1', port: Number(process.env.GROUP_RIDE_PORT) })
console.log(`Group Ride relay listening on ${app.server.port}`)
const stop = async () => {
  await app.stop(true)
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
