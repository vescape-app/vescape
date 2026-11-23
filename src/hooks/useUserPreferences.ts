import { createContext, use } from 'react'
import type { DateFormat, TimeFormat } from '@/helpers/time'
import type { DistanceUnit, TemperatureUnit } from '@/helpers/units'

export interface UserPreferences {
  distanceUnit: DistanceUnit
  temperatureUnit: TemperatureUnit
  timeFormat: TimeFormat
  dateFormat: DateFormat
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  distanceUnit: 'km',
  temperatureUnit: 'celsius',
  timeFormat: '24h',
  dateFormat: 'dmy',
}

export const UserPreferencesContext = createContext<UserPreferences>(DEFAULT_USER_PREFERENCES)

export function useUserPreferences(): UserPreferences {
  return use(UserPreferencesContext)
}
