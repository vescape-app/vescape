import { beforeEach, expect, mock, test } from 'bun:test'

const captureMessage = mock(() => undefined)
const reportUiError = mock(() => undefined)

mock.module('@sentry/react-native', () => ({ init: () => undefined, captureMessage }))

const {
  reportUnexpectedError,
  resetUnexpectedErrorReportsForTests,
  setUnexpectedUiReporterForTests,
} = await import('@/config/sentry')

beforeEach(() => {
  captureMessage.mockClear()
  reportUiError.mockClear()
  resetUnexpectedErrorReportsForTests()
  setUnexpectedUiReporterForTests(reportUiError)
})

test('unexpected UI failures are sanitized and deduplicated by operation', () => {
  reportUnexpectedError(new TypeError('https://secret.example/token'), 'map_projection')
  reportUnexpectedError(new Error('another private value'), 'map_projection')

  expect(captureMessage).toHaveBeenCalledTimes(1)
  expect(captureMessage).toHaveBeenCalledWith('Unexpected UI operation failure', {
    level: 'error',
    tags: { source: 'map_projection', errorName: 'TypeError' },
    fingerprint: ['unexpected-ui-operation', 'map_projection', 'TypeError'],
  })
  expect(reportUiError).toHaveBeenCalledWith(
    'Unexpected UI operation failure (TypeError)',
    'map_projection',
    null,
  )
})

test('custom error names cannot enter diagnostic payloads', () => {
  const error = new Error('private')
  error.name = 'token-secret-value'
  reportUnexpectedError(error, 'external_link')

  expect(captureMessage).toHaveBeenCalledWith('Unexpected UI operation failure', {
    level: 'error',
    tags: { source: 'external_link', errorName: 'Error' },
    fingerprint: ['unexpected-ui-operation', 'external_link', 'Error'],
  })
})
