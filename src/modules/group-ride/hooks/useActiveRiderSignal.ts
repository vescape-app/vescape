import { useEffect, useState } from 'react'

import type { GroupRidePin } from 'vescape-core'

import { type RelayClock, signalTimeLeftMs } from '@/modules/group-ride/lib/riderSignal'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'

export function useActiveRiderSignal(signal: GroupRidePin | null | undefined): GroupRidePin | null {
  return useActivePin(
    signal,
    useGroupRideStore((s) => s.relayClock),
  )
}

export function useActivePin(
  signal: GroupRidePin | null | undefined,
  relayClock: RelayClock | null,
): GroupRidePin | null {
  const [expired, setExpired] = useState<GroupRidePin | null>(null)

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
