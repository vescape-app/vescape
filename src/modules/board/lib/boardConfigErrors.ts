import type { RefloatConfigErrorCode } from 'vescape-core'

import { errorMessage } from '@/helpers/error'

const BOARD_CONFIG_ERROR_MESSAGES: Partial<Record<RefloatConfigErrorCode | string, string>> = {
  CONFIG_SCHEMA_MISMATCH:
    'Board firmware schema changed since these changes were prepared. Re-check the config and try again.',
  CONFIG_VALUE_INVALID: 'The board cannot store one of these values. Nothing was written.',
  BOARD_NOT_IDLE:
    'Config changes are only written while the board is idle. Step off, leave handtest, wait for live data, and try again.',
  BOARD_NOT_CONNECTED: 'Connect to this board and wait for a fresh config read before reverting.',
  REVISION_NOT_FOUND: 'This config revision is no longer available.',
  SCHEMA_NOT_FOUND:
    'The firmware schema for this revision is unavailable, so it cannot be restored automatically.',
  APP_STORAGE_READ_FAILED: 'Unable to read saved config history from storage.',
}

export function boardConfigErrorMessage(
  error: unknown,
  fallback = 'Board configuration could not be written.',
): string {
  const code = (error as { code?: unknown } | null)?.code
  const message =
    typeof code === 'string'
      ? BOARD_CONFIG_ERROR_MESSAGES[code as RefloatConfigErrorCode]
      : undefined
  return message ?? errorMessage(error, fallback)
}
