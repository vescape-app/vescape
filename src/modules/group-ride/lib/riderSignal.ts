import type { GroupRidePin } from 'vescape-core'

export interface RelayClock {
  relayNow: number
  receivedAt: number
}

export const monotonicNowMs = (): number => performance.now()

export function relayNow(clock: RelayClock, localNow = monotonicNowMs()): number {
  return clock.relayNow + (localNow - clock.receivedAt)
}

export function signalTimeLeftMs(
  signal: GroupRidePin,
  clock: RelayClock,
  localNow = monotonicNowMs(),
): number {
  return Math.max(0, signal.expiresAt - relayNow(clock, localNow))
}

export function topRiderSignal(
  signals: readonly GroupRidePin[],
  clock: RelayClock,
  rankOf: (kind: string) => number | null,
  localNow = monotonicNowMs(),
): GroupRidePin | null {
  let top: GroupRidePin | null = null
  let topRank = -Infinity
  for (const signal of signals) {
    const rank = rankOf(signal.kind)
    if (rank === null || signalTimeLeftMs(signal, clock, localNow) <= 0) continue
    if (top === null || rank > topRank || (rank === topRank && signal.startedAt > top.startedAt)) {
      top = signal
      topRank = rank
    }
  }
  return top
}
