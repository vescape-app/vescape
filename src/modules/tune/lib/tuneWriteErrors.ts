import type { RefloatConfigErrorCode } from 'vescape-core'
import { errorMessage } from '@/helpers/error'

const MESSAGES: Partial<Record<RefloatConfigErrorCode, string>> = {
  CONFIG_SCHEMA_MISMATCH:
    'Board firmware schema changed since this tune was loaded. Re-read the board config and try again.',
  CONFIG_VALUE_INVALID: 'The board cannot store one of these values. Nothing was written.',
  BOARD_NOT_IDLE:
    'Tunes are only sent while the board is idle. Step off, leave handtest, wait for live data, and try again.',
}

export function tuneWriteErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  const message = typeof code === 'string' ? MESSAGES[code as RefloatConfigErrorCode] : undefined
  return message ?? errorMessage(error, 'Unable to sync tune profile to the board.')
}
