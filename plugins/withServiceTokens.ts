import {
  AndroidConfig,
  withAndroidManifest,
  withInfoPlist,
  type ConfigPlugin,
} from 'expo/config-plugins'

/**
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
