import type { RefloatConfigErrorCode } from 'vescape-core'
import { errorMessage } from '@/helpers/error'

const MESSAGES: Partial<Record<RefloatConfigErrorCode, string>> = {
  CONFIG_VALUE_INVALID: 'The board cannot store one of these values. Nothing was written.',
}

export function tuneWriteErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  const message = typeof code === 'string' ? MESSAGES[code as RefloatConfigErrorCode] : undefined
  return message ?? errorMessage(error, 'Unable to sync tune profile to the board.')
}
