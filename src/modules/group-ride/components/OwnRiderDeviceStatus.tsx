import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { getPhoneBatteryLevel } from 'vescape-core'

import { fmtPercent } from '@/helpers/format'
import { useBleStore } from '@/modules/board/store/bleStore'
import { RiderDeviceStatus } from '@/modules/group-ride/components/RiderDeviceStatus'

export function OwnRiderDeviceStatus() {
  const boardConnected = useBleStore((state) => state.status === 'connected')
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

  return (
    <RiderDeviceStatus
      boardConnected={boardConnected}
      phoneBattery={phoneBattery == null ? undefined : fmtPercent(phoneBattery)}
    />
  )
}
