import { describe, expect, it } from 'bun:test'
import {
  missingProductionConfig,
  REQUIRED_PRODUCTION_ENV,
  sentryAppDelegateInitProblems,
  sentryManifestInitProblems,
} from './productionConfig.ts'

const appDelegate = ({
  start = true,
  afterReactNative = false,
}: { start?: boolean; afterReactNative?: boolean } = {}) => {
  const sentry = `SentrySDK.start { options in
      options.dsn = "https://key@sentry.io/1"
#if DEBUG
      options.environment = "development"
#else
      options.environment = "production"
#endif
    }`
  const boot = 'factory.startReactNative(withModuleName: "main", in: window)'
  if (!start) return boot
  return afterReactNative ? `${boot}\n${sentry}` : `${sentry}\n${boot}`
}

const completeEnv = Object.fromEntries(REQUIRED_PRODUCTION_ENV.map((name) => [name, 'value']))

const manifest = (metaData: string) => `<manifest><application>${metaData}</application></manifest>`

const sentryMetaData = `
  <meta-data android:name="io.sentry.dsn" android:value="https://key@sentry.io/1"/>
  <meta-data android:name="io.sentry.auto-init" android:value="true"/>
  <meta-data android:name="io.sentry.environment" android:value="production"/>
`

describe('missingProductionConfig', () => {
  it('accepts a complete environment', () => {
    expect(missingProductionConfig(completeEnv)).toEqual([])
  })

  it('reports unset and blank values', () => {
    const env = { ...completeEnv, EXPO_PUBLIC_SENTRY_DSN: undefined, SENTRY_AUTH_TOKEN: '  ' }
    expect(missingProductionConfig(env)).toEqual(['EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN'])
  })
})

describe('sentryManifestInitProblems', () => {
  it('accepts a manifest that starts Sentry before JS', () => {
    expect(sentryManifestInitProblems(manifest(sentryMetaData))).toEqual([])
  })

  it('rejects the React Native SDK default auto-init', () => {
    const merged = manifest('<meta-data android:name="io.sentry.auto-init" android:value="false"/>')
    expect(sentryManifestInitProblems(merged)).toEqual([
      'io.sentry.auto-init is "false"',
      'io.sentry.dsn is missing',
      'io.sentry.environment is "<missing>"',
    ])
  })

  it('rejects an unresolved environment placeholder', () => {
    const merged = manifest(
      sentryMetaData.replace('android:value="production"', 'android:value="${sentryEnvironment}"'),
    )
    expect(sentryManifestInitProblems(merged)).toEqual([
      'io.sentry.environment is "${sentryEnvironment}"',
    ])
  })

  it('reads attributes written in either order', () => {
    const merged = manifest(
      '<meta-data android:value="true" android:name="io.sentry.auto-init"/>' +
        '<meta-data android:value="https://key@sentry.io/1" android:name="io.sentry.dsn"/>' +
        '<meta-data android:value="production" android:name="io.sentry.environment"/>',
    )
    expect(sentryManifestInitProblems(merged)).toEqual([])
  })
})

describe('sentryAppDelegateInitProblems', () => {
  it('accepts an AppDelegate that starts Sentry before React Native', () => {
    expect(sentryAppDelegateInitProblems(appDelegate())).toEqual([])
  })

  it('rejects an AppDelegate the plugin never touched', () => {
    expect(sentryAppDelegateInitProblems(appDelegate({ start: false }))).toEqual([
      'SentrySDK.start is missing',
      'options.dsn is missing',
      'options.environment has no production branch',
    ])
  })

  it('rejects a start that runs after the bundle boots', () => {
    expect(sentryAppDelegateInitProblems(appDelegate({ afterReactNative: true }))).toEqual([
      'SentrySDK.start runs after startReactNative',
    ])
  })

  it('rejects an AppDelegate with no recognisable boot call', () => {
    const source = appDelegate().replace('factory.startReactNative', 'factory.bootSomethingElse')
    expect(sentryAppDelegateInitProblems(source)).toEqual([
      'startReactNative is missing — cannot verify Sentry starts first',
    ])
  })

  it('rejects an empty DSN', () => {
    const source = appDelegate().replace('https://key@sentry.io/1', '')
    expect(sentryAppDelegateInitProblems(source)).toEqual(['options.dsn is missing'])
  })
})
