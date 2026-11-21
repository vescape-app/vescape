import {
  AndroidConfig,
  IOSConfig,
  withAndroidManifest,
  withInfoPlist,
  type ConfigPlugin,
} from 'expo/config-plugins'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/appstatus/AppStatusCoordinator.kt `SERVER_BASE_URL_METADATA`
 * @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinator.swift `serverBaseUrlInfoKey`
 */
const ANDROID_METADATA_NAME = 'app.vescape.SERVER_BASE_URL'
const IOS_INFO_PLIST_KEY = 'VescapeServerBaseUrl'
const PRODUCTION_SERVER_URL = 'https://api.vescape.app'

const withServerOrigin: ConfigPlugin = (config) => {
  const serverUrl = process.env.EXPO_PUBLIC_SERVER_URL || PRODUCTION_SERVER_URL

  config = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults)
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, ANDROID_METADATA_NAME, serverUrl)
    return cfg
  })

  return withInfoPlist(config, (cfg) => {
    cfg.modResults[IOS_INFO_PLIST_KEY] = serverUrl

    const { protocol, hostname } = new URL(serverUrl)
    if (protocol === 'http:') {
      const appTransportSecurity = asPlistObject(cfg.modResults.NSAppTransportSecurity)
      const exceptionDomains = asPlistObject(appTransportSecurity.NSExceptionDomains)
      cfg.modResults.NSAppTransportSecurity = {
        ...appTransportSecurity,
        NSExceptionDomains: {
          ...exceptionDomains,
          [hostname]: { NSExceptionAllowsInsecureHTTPLoads: true, NSIncludesSubdomains: true },
        },
      }
    }
    return cfg
  })
}

type PlistObject = Extract<NonNullable<IOSConfig.InfoPlist[string]>, Record<string, unknown>>

function asPlistObject(value: unknown): PlistObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlistObject)
    : {}
}

export default withServerOrigin
