/**
 * Release-time contract for the runtime configuration a production artifact must carry.
 *
 * A missing `EXPO_PUBLIC_*` value does not fail the build — it silently ships an artifact that
 * either crashes on cold start (Clerk key, VESCAPE-294) or, worse, ships unmonitored because
 * `plugins/withSentryNativeInit` no-ops and `initSentry()` runs disabled. The release workflow
 * checks this contract before prebuild so the failure is loud and early.
 */
export const REQUIRED_PRODUCTION_ENV = [
  'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN',
  'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY',
  'EXPO_PUBLIC_MAPY_API_KEY',
  'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_SENTRY_DSN',
  // No analytics keys: diagnostics stay local-only (ADR 0031) and Sentry owns monitoring.
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SENTRY_AUTH_TOKEN',
] as const

export const missingProductionConfig = (env: Record<string, string | undefined>): string[] =>
  REQUIRED_PRODUCTION_ENV.filter((name) => !env[name]?.trim())

/**
 * The merged Android manifest must start the Sentry SDK from the manifest ContentProvider, before
 * the JS bundle loads. `@sentry/react-native` ships `auto-init=false`, so a merge that drops
 * `plugins/withSentryNativeInit` leaves a production build blind to pre-JS startup failures.
 */
export type SentryNativeInitProblem = string

export const sentryManifestInitProblems = (mergedManifest: string): SentryNativeInitProblem[] => {
  const metaData = (name: string) =>
    new RegExp(`android:name="${name}"[^/>]*android:value="([^"]*)"`).exec(mergedManifest)?.[1] ??
    new RegExp(`android:value="([^"]*)"[^/>]*android:name="${name}"`).exec(mergedManifest)?.[1]

  const problems: SentryNativeInitProblem[] = []
  const autoInit = metaData('io\\.sentry\\.auto-init')
  const dsn = metaData('io\\.sentry\\.dsn')
  const environment = metaData('io\\.sentry\\.environment')

  if (autoInit !== 'true') problems.push(`io.sentry.auto-init is "${autoInit ?? '<missing>'}"`)
  if (!dsn) problems.push('io.sentry.dsn is missing')
  if (environment !== 'production') {
    problems.push(`io.sentry.environment is "${environment ?? '<missing>'}"`)
  }
  return problems
}

/**
 * The generated iOS AppDelegate must call `SentrySDK.start` before React Native boots. sentry-cocoa
 * only starts from code, so if `plugins/withSentryNativeInit` fails to inject (Expo template drift,
 * missing DSN at prebuild), the artifact ships blind to everything that crashes before JS runs.
 */
export const sentryAppDelegateInitProblems = (appDelegate: string): SentryNativeInitProblem[] => {
  const problems: SentryNativeInitProblem[] = []
  const start = appDelegate.indexOf('SentrySDK.start')
  const reactNative = appDelegate.indexOf('startReactNative')

  if (start < 0) {
    problems.push('SentrySDK.start is missing')
  }
  // No boot marker means the ordering claim cannot be checked at all — treat that as a failure
  // rather than passing an artifact whose init order is unknown.
  if (reactNative < 0) {
    problems.push('startReactNative is missing — cannot verify Sentry starts first')
  } else if (start >= 0 && start > reactNative) {
    problems.push('SentrySDK.start runs after startReactNative')
  }
  if (!/options\.dsn = "https:\/\/[^"]+"/.test(appDelegate)) problems.push('options.dsn is missing')
  if (!appDelegate.includes('options.environment = "production"')) {
    problems.push('options.environment has no production branch')
  }
  return problems
}
