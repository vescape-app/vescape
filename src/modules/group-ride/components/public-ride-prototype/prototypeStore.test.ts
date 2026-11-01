import { expect, test } from 'bun:test'
import { usePublicRidePrototypeStore } from './prototypeStore'

test('committing a timed selection publishes the mode and hours in one snapshot', () => {
  usePublicRidePrototypeStore.setState({ mode: 'automatic', hours: 2 })
  const snapshots: { mode: string; hours: number }[] = []
  const unsubscribe = usePublicRidePrototypeStore.subscribe(({ mode, hours }) =>
    snapshots.push({ mode, hours }),
  )
  try {
    usePublicRidePrototypeStore.getState().setMode('hours', 7)
    expect(snapshots).toEqual([{ mode: 'hours', hours: 7 }])
  } finally {
    unsubscribe()
    usePublicRidePrototypeStore.setState(usePublicRidePrototypeStore.getInitialState())
  }
})
