import { useEffect, useRef, useState } from 'react'
import { addAppStatusListener } from 'vescape-core'

import { useDeviceAccountId } from '@/modules/profile/hooks/useDeviceAccountReady'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'

const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000]

export function RiderProfileSync() {
  const ready = useDeviceAccountId()
  const failed = useRiderProfileStore((s) => !s.loaded && s.error != null)
  const attempt = useRef(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const store = useRiderProfileStore.getState()
    attempt.current = 0
    if (ready) void store.load()
    else store.clear()
  }, [ready])

  useEffect(() => {
    if (!ready || !failed) return
    const retry = () => {
      attempt.current += 1
      setTick((n) => n + 1)
      void useRiderProfileStore.getState().load()
    }
    const timer = setTimeout(
      retry,
      RETRY_DELAYS_MS[Math.min(attempt.current, RETRY_DELAYS_MS.length - 1)],
    )
    const subscription = addAppStatusListener(retry)
    return () => {
      clearTimeout(timer)
      subscription.remove()
    }
  }, [failed, ready, tick])

  return null
}
