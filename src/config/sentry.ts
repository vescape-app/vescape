import * as Sentry from '@sentry/react-native'
import { reportUiError } from 'vescape-core'

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN

export const initSentry = () => {
  Sentry.init({
    dsn,
    enabled: !__DEV__ && Boolean(dsn),
    environment: 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // @parity /plugins/withSentryNativeInit.ts `sentryStartSwift`
    ...({ enableMetricKit: true } as object),
  })
}

const reportedUnexpectedSources = new Set<string>()
let unexpectedUiReporter = reportUiError

export function reportUnexpectedError(error: unknown, source: string): void {
  if (reportedUnexpectedSources.has(source)) return
  reportedUnexpectedSources.add(source)
  const knownNames = new Set([
    'Error',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'ReferenceError',
    'URIError',
  ])
  const errorName = error instanceof Error && knownNames.has(error.name) ? error.name : 'Error'
  Sentry.captureMessage('Unexpected UI operation failure', {
    level: 'error',
    tags: { source, errorName },
    fingerprint: ['unexpected-ui-operation', source, errorName],
  })
  unexpectedUiReporter(`Unexpected UI operation failure (${errorName})`, source, null)
}

export function resetUnexpectedErrorReportsForTests(): void {
  reportedUnexpectedSources.clear()
  unexpectedUiReporter = reportUiError
}

export function setUnexpectedUiReporterForTests(reporter: typeof reportUiError): void {
  unexpectedUiReporter = reporter
}
