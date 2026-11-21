export const REQUIRED_PRODUCTION_ENV = [
  'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_SENTRY_DSN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SENTRY_AUTH_TOKEN',
] as const

export const missingProductionConfig = (env: Record<string, string | undefined>): string[] =>
  REQUIRED_PRODUCTION_ENV.filter((name) => !env[name]?.trim())

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

export const sentryAppDelegateInitProblems = (appDelegate: string): SentryNativeInitProblem[] => {
  const problems: SentryNativeInitProblem[] = []
  const start = appDelegate.indexOf('SentrySDK.start')
  const directBoot = appDelegate.indexOf('startReactNative')
  const sceneFactory = /class\s+AppDelegate\s*:[^{]*\bExpoReactNativeFactoryProvider\b/.test(
    appDelegate,
  )
    ? (/\breactNativeFactory\s*=\s*factory\b/.exec(appDelegate)?.index ?? -1)
    : -1
  const reactNative = directBoot >= 0 ? directBoot : sceneFactory
  const bootMarker = directBoot >= 0 ? 'startReactNative' : 'reactNativeFactory assignment'

  if (start < 0) {
    problems.push('SentrySDK.start is missing')
  }
  if (reactNative < 0) {
    problems.push('startReactNative is missing — cannot verify Sentry starts first')
  } else if (start >= 0 && start > reactNative) {
    problems.push(`SentrySDK.start runs after ${bootMarker}`)
  }
  if (!/options\.dsn = "https:\/\/[^"]+"/.test(appDelegate)) problems.push('options.dsn is missing')
  if (!appDelegate.includes('options.environment = "production"')) {
    problems.push('options.environment has no production branch')
  }
  return problems
}
