import { createContext, use } from 'react'
import type { UnitSystem } from '@/helpers/units'

/** App composition supplies the persisted preference; previews can supply either system. */
export const UnitSystemContext = createContext<UnitSystem>('metric')

export function useUnitSystem(): UnitSystem {
  return use(UnitSystemContext)
}
