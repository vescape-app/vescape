import {
  AndroidConfig,
  withAndroidManifest,
  withInfoPlist,
  type ConfigPlugin,
} from 'expo/config-plugins'

/**
 * Bakes the seed Service Config tokens into both native projects at prebuild time.
 *
 * Native owns Service Config: it fetches `GET /api/service-config` on launch and foreground and
 * persists the last good answer. Before the server has ever answered (first launch, offline), it
 * falls back to these seeds, so a build made with tokens has a map from the first frame. Both are
 * optional: unset → empty, and native waits for the server.
 *
 * Prebuild runs in a shell that already loaded `.env`/`.env.local`, so changing a seed needs a fresh
 * prebuild — `scripts/native-sync.ts` fingerprints the env files so `bun run android` /
 * `bun run ios` do that on their own. Same shape as `withServerOrigin`.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/serviceconfig/ServiceConfig.kt `MAPBOX_SEED_METADATA`
 * @parity /modules/vescape-core/ios/serviceconfig/ServiceConfig.swift `mapboxSeedInfoKey`
 */
const ANDROID_METADATA = {
  mapbox: 'app.vescape.MAPBOX_ACCESS_TOKEN',
  mapy: 'app.vescape.MAPY_API_KEY',
} as const
const IOS_INFO_PLIST_KEYS = {
  mapbox: 'VescapeMapboxAccessToken',
  mapy: 'VescapeMapyApiKey',
} as const

const withServiceTokens: ConfigPlugin = (config) => {
  const seeds = {
    mapbox: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '',
    mapy: process.env.EXPO_PUBLIC_MAPY_API_KEY ?? '',
  }
  const services = Object.keys(seeds) as (keyof typeof seeds)[]

  config = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults)
    for (const service of services) {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(
        app,
        ANDROID_METADATA[service],
        seeds[service],
      )
    }
    return cfg
  })

  return withInfoPlist(config, (cfg) => {
    for (const service of services) cfg.modResults[IOS_INFO_PLIST_KEYS[service]] = seeds[service]
    return cfg
  })
}

export default withServiceTokens
