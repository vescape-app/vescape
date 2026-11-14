import { create } from 'zustand'
import { addRideNoticesListener, getRideNotices, type RideNotice } from 'vescape-core'

/** JS mirror of the native Ride Notice table: the visible list, most urgent first. */
interface RideNoticesState {
  notices: RideNotice[]
}

export const useRideNoticesStore = create<RideNoticesState>(() => ({ notices: [] }))

/**
 * Wire the native → JS Ride Notice mirror. Call once at app root; returns an unsubscribe.
 * Native emits on every change, on subscribe and on returning to the foreground (emits are gated
 * while hidden), so the store never needs to merge.
 */
export function startRideNoticesSync(): () => void {
  const sub = addRideNoticesListener(({ notices }) => useRideNoticesStore.setState({ notices }))
  useRideNoticesStore.setState({ notices: getRideNotices() })
  return () => sub.remove()
}
