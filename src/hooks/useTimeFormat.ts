import { createContext, use } from 'react'
import type { TimeFormat } from '@/helpers/time'

/** App composition supplies the persisted preference; previews may override it. */
export const TimeFormatContext = createContext<TimeFormat>('24h')

export function useTimeFormat(): TimeFormat {
  return use(TimeFormatContext)
}
