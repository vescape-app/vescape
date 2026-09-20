import { describe, expect, test } from 'bun:test'

import {
  initialMapStyleLifecycle,
  mapStyleLifecycle,
  type MapStyleDocument,
} from '@/screens/main/map/mapStyleLifecycle'

const dark: MapStyleDocument = {
  styleKey: 'satellite',
  styleSignature: 'json:satellite:dark',
  styleJSON: '{"name":"dark"}',
}
const light: MapStyleDocument = {
  ...dark,
  styleSignature: 'json:satellite:light',
  styleJSON: '{"name":"light"}',
}
const streets: MapStyleDocument = {
  styleKey: 'onedark',
  styleSignature: 'json:onedark',
  styleJSON: '{"name":"streets"}',
}

describe('serialized map style loading', () => {
  test('a late completion cannot acknowledge a newer requested document', () => {
    let state = initialMapStyleLifecycle(dark)
    state = mapStyleLifecycle(state, { type: 'request', document: light })
    state = mapStyleLifecycle(state, { type: 'request', document: streets })
    // Until the old native load completes, neither intermediate request reaches Mapbox.
    expect(state.applied).toBe(dark)
    expect(state.phase).toBe('loading')
    state = mapStyleLifecycle(state, { type: 'loaded', generation: 0 })
    expect(state.phase).toBe('detaching')
    expect(state.applied).toBe(dark)
    // A duplicate completion during the layer-removal commit cannot release the next style.
    expect(mapStyleLifecycle(state, { type: 'loaded', generation: 0 })).toBe(state)
    state = mapStyleLifecycle(state, { type: 'apply' })
    expect(state.applied).toBe(streets)
    expect(state.phase).toBe('loading')
    state = mapStyleLifecycle(state, { type: 'loaded', generation: 0 })
    expect(state.phase).toBe('ready')
  })

  test('returning to the applied style before replacement cancels the swap', () => {
    let state = mapStyleLifecycle(initialMapStyleLifecycle(dark), { type: 'loaded', generation: 0 })
    state = mapStyleLifecycle(state, { type: 'request', document: light })
    expect(state.phase).toBe('detaching')
    state = mapStyleLifecycle(state, { type: 'request', document: dark })
    state = mapStyleLifecycle(state, { type: 'apply' })
    expect(state.applied).toBe(dark)
    expect(state.phase).toBe('ready')
    expect(state.loadCount).toBe(1)
  })

  test('theme-only swaps preserve camera initialization; native-view retries initialize again', () => {
    let state = initialMapStyleLifecycle(dark)
    const cameraLoads: boolean[] = []
    const complete = () => {
      state = mapStyleLifecycle(state, { type: 'loaded', generation: state.generation })
      cameraLoads.push(state.loadCount > 1)
    }
    complete()
    state = mapStyleLifecycle(state, { type: 'request', document: light })
    state = mapStyleLifecycle(state, { type: 'apply' })
    expect(state.applied.styleKey).toBe(dark.styleKey)
    complete()
    state = mapStyleLifecycle(state, { type: 'retry' })
    complete()
    expect(cameraLoads).toEqual([false, true, false])
  })

  test('failure of a superseded load recreates the view and ignores its late completion', () => {
    let state = initialMapStyleLifecycle(dark)
    state = mapStyleLifecycle(state, { type: 'request', document: light })
    state = mapStyleLifecycle(state, { type: 'failed', generation: 0 })
    expect(state.applied).toBe(light)
    expect(state.generation).toBe(1)
    expect(mapStyleLifecycle(state, { type: 'loaded', generation: 0 })).toBe(state)
    expect(mapStyleLifecycle(state, { type: 'failed', generation: 0 })).toBe(state)
    state = mapStyleLifecycle(state, { type: 'loaded', generation: 1 })
    expect(state.phase).toBe('ready')
  })

  test('a new selection recovers a failed load without trusting late events from the failed view', () => {
    let state = initialMapStyleLifecycle(dark)
    state = mapStyleLifecycle(state, { type: 'failed', generation: 0 })
    expect(state.phase).toBe('failed')
    expect(mapStyleLifecycle(state, { type: 'loaded', generation: 0 })).toBe(state)
    state = mapStyleLifecycle(state, { type: 'request', document: streets })
    expect(state.applied).toBe(streets)
    expect(state.generation).toBe(1)
    expect(state.phase).toBe('loading')
  })
})
