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

test('show on map reveals pins and keeps the requested list stable until camera framing', () => {
  const store = usePublicRidePrototypeStore
  try {
    const ids = ['ola', 'maja']
    store.getState().requestMap(ids)
    ids.push('kuba')
    const request = store.getState().mapRequest
    expect(store.getState().showRidersOnMap).toBe(true)
    expect(request?.riderIds).toEqual(['ola', 'maja'])
    if (!request) throw new Error('Expected a pending map request')
    store.getState().clearMapRequest(request)
    expect(store.getState().mapRequest).toBeNull()
    expect(store.getState().showRidersOnMap).toBe(true)
  } finally {
    store.setState(store.getInitialState())
  }
})

test('an old framing cannot consume a newer request, and going private cancels pending framing', () => {
  const store = usePublicRidePrototypeStore
  try {
    store.getState().requestMap(['ola'])
    const old = store.getState().mapRequest
    store.getState().requestMap(['ola', 'maja'])
    if (!old) throw new Error('Expected a pending map request')
    store.getState().clearMapRequest(old)
    expect(store.getState().mapRequest?.riderIds).toEqual(['ola', 'maja'])
    store.getState().setMode('off')
    expect(store.getState().mapRequest).toBeNull()
  } finally {
    store.setState(store.getInitialState())
  }
})
