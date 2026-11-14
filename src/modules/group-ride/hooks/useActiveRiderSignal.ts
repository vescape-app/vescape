import { useEffect, useState } from 'react'

import type { GroupRidePin } from 'vescape-core'

import { type RelayClock, signalTimeLeftMs } from '@/modules/group-ride/lib/riderSignal'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'

/**
 * The signal while it is active on the relay clock, else null. Re-renders once at expiry, so a
 * signal the relay has not cleared yet still drops off on time.
 */
export function useActiveRiderSignal(signal: GroupRidePin | null | undefined): GroupRidePin | null {
  return useActivePin(
    signal,
    useGroupRideStore((s) => s.relayClock),
  )
}

/** `useActiveRiderSignal` against a given relay clock rather than the live one. */
export function useActivePin(
  signal: GroupRidePin | null | undefined,
  relayClock: RelayClock | null,
): GroupRidePin | null {
  const [expired, setExpired] = useState<GroupRidePin | null>(null)

  // Delay computed inside: depending on a render-time `leftMs` would re-arm the timer every render.
  useEffect(() => {
    if (!signal || !relayClock) return
    const leftMs = signalTimeLeftMs(signal, relayClock)
    if (leftMs <= 0) return
    const id = setTimeout(() => setExpired(signal), leftMs)
    return () => clearTimeout(id)
  }, [signal, relayClock])

  const active =
    signal && relayClock && expired !== signal && signalTimeLeftMs(signal, relayClock) > 0
  return active ? signal : null
}
