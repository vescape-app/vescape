import { create } from 'zustand'
import { addRideNoticesListener, getRideNotices, type RideNotice } from 'vescape-core'

interface RideNoticesState {
  notices: RideNotice[]
}

export const useRideNoticesStore = create<RideNoticesState>(() => ({ notices: [] }))

export function startRideNoticesSync(): () => void {
  const sub = addRideNoticesListener(({ notices }) => useRideNoticesStore.setState({ notices }))
  useRideNoticesStore.setState({ notices: getRideNotices() })
  return () => sub.remove()
}
