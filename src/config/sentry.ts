import * as Sentry from '@sentry/react-native'

/**
 * Crash and error monitoring. Captures native crashes (Kotlin/Swift, signal
 * handlers) and unhandled JS errors — the failures PostHog diagnostics can't
 * see because they kill the app before any event is sent.
 *
 * On Android the native SDK is already running before this executes
 * (manifest auto-init via `plugins/withSentryNativeInit`), so crashes during
 * native startup are captured too; this call re-initializes it with the JS
 * options and hooks up the JS error handlers.
 *
 * On iOS `plugins/withSentryNativeInit` injects `SentrySDK.start` into the AppDelegate, ahead of
 * React Native, so the same pre-JS window is covered; this call re-initializes with the JS options.
 *
 * Disabled in dev builds (`__DEV__`) and when `EXPO_PUBLIC_SENTRY_DSN` is unset — local crashes
 * are noise in the production issue stream. The native pre-JS init is compiled out of debug
 * builds too (`plugins/withSentryNativeInit`).
 */
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN

export const initSentry = () => {
  Sentry.init({
    dsn,
    enabled: !__DEV__ && Boolean(dsn),
    environment: 'production',
    sendDefaultPii: false,
    // Errors only — no performance tracing.
    tracesSampleRate: 0,
    // Re-initializing the native SDK drops options it does not know about, so the iOS-only
    // MetricKit flag set in the AppDelegate has to be repeated here or the integration is
    // uninstalled the moment JS boots. Not in the React Native option type, but sentry-cocoa
    // reads it straight off the bridged dictionary (SentyOptionsInternal `enableMetricKit`).
    // @parity /plugins/withSentryNativeInit.ts `sentryStartSwift`
    ...({ enableMetricKit: true } as object),
  })
}
