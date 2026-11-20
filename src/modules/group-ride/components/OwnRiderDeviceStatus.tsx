import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { getPhoneBatteryLevel } from 'vescape-core'

import { RiderLiveRide } from '@/modules/group-ride/components/RiderLiveRide'
import { useOwnRiderReadings } from '@/modules/group-ride/hooks/useOwnRiderReadings'

export function OwnRiderDeviceStatus() {
  const readings = useOwnRiderReadings()
  const [phoneBattery, setPhoneBattery] = useState<number | null>(null)

  useFocusEffect(
    useCallback(() => {
      let focused = true
      async function refresh() {
        // intentional-suppression: Hide the optional battery reading on native errors and retry on the next poll.
        const level = await getPhoneBatteryLevel().catch(() => null)
        if (focused) setPhoneBattery(level)
      }
      void refresh()
      const interval = setInterval(() => void refresh(), 30_000)
      return () => {
        focused = false
        clearInterval(interval)
      }
    }, []),
  )

  return <RiderLiveRide readings={{ ...readings, phoneBattery }} />
}
