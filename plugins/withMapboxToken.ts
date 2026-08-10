import {
  AndroidConfig,
  withAndroidManifest,
  withInfoPlist,
  type ConfigPlugin,
} from 'expo/config-plugins'

/**
 * Bakes the Mapbox access token into both native projects at prebuild time.
 *
 * Navigation is computed natively (Mapbox Directions) and must keep working while the JS runtime is
 * gone, so native cannot wait for JS to hand it `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`. Prebuild can:
 * it runs in a shell that already loaded `.env`/`.env.local`, so the value is written into the
 * Android manifest and the iOS Info.plist and read back natively — the same shape as
 * `withServerOrigin` and the companion-injection pattern in `docs/adr/0019-watch-mirror-as-config-plugin-injected-native-companion.md`.
 *
 * Unset → empty, and native then computes no Navigation rather than calling Directions unauthenticated.
 *
 * Changing `.env` therefore needs a fresh prebuild — `scripts/native-sync.ts` fingerprints the env
 * files so `bun run android` / `bun run ios` do that on their own.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/MapboxDirectionsApi.kt `ACCESS_TOKEN_METADATA`
 * @parity /modules/vescape-core/ios/navigation/MapboxDirectionsApi.swift `accessTokenInfoKey`
 */
const ANDROID_METADATA_NAME = 'app.vescape.MAPBOX_ACCESS_TOKEN'
const IOS_INFO_PLIST_KEY = 'VescapeMapboxAccessToken'

const withMapboxToken: ConfigPlugin = (config) => {
  const accessToken = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? ''

  config = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults)
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, ANDROID_METADATA_NAME, accessToken)
    return cfg
  })

  return withInfoPlist(config, (cfg) => {
    cfg.modResults[IOS_INFO_PLIST_KEY] = accessToken
    return cfg
  })
}

export default withMapboxToken
