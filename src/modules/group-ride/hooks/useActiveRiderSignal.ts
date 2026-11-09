import { useEffect, useState } from 'react'

import type { GroupRideSignal } from 'vescape-core'

import { signalTimeLeftMs } from '@/modules/group-ride/lib/riderSignal'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'

/**
 * The signal while it is active on the relay clock, else null. Re-renders once at expiry, so a
 * signal the relay has not cleared yet still drops off on time.
 */
export function useActiveRiderSignal(
  signal: GroupRideSignal | null | undefined,
): GroupRideSignal | null {
  const relayClock = useGroupRideStore((s) => s.relayClock)
  const leftMs = signal && relayClock ? signalTimeLeftMs(signal, relayClock) : 0
  const [expired, setExpired] = useState<GroupRideSignal | null>(null)

  useEffect(() => {
    if (!signal || leftMs <= 0) return
    const id = setTimeout(() => setExpired(signal), leftMs)
    return () => clearTimeout(id)
  }, [signal, leftMs])

  return signal && leftMs > 0 && expired !== signal ? signal : null
}
