import { createContext, use } from 'react'
import type { DistanceUnit } from '@/helpers/units'

export const DistanceUnitContext = createContext<DistanceUnit>('km')

export function useDistanceUnit(): DistanceUnit {
  return use(DistanceUnitContext)
}
