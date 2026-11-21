import { createContext, use } from 'react'
import type { TimeFormat } from '@/helpers/time'

export const TimeFormatContext = createContext<TimeFormat>('24h')

export function useTimeFormat(): TimeFormat {
  return use(TimeFormatContext)
}
