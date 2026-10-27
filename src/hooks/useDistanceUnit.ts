import { createContext, use } from 'react'
import type { DistanceUnit } from '@/helpers/units'

/** App composition supplies the persisted preference; previews can supply either system. */
export const DistanceUnitContext = createContext<DistanceUnit>('km')

export function useDistanceUnit(): DistanceUnit {
  return use(DistanceUnitContext)
}
