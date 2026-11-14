import { afterEach, describe, expect, test } from 'bun:test'

import { markerLayerChannel } from '@/components/map/markerLayerChannel'

const STRIDE = 6

async function sent(run: () => void) {
  const calls: number[][] = []
  markerLayerChannel.attach((values) => calls.push(values))
  calls.length = 0
  run()
  await Promise.resolve()
  return calls
}

const versionOf = (values: number[]) => values[3]

describe('markerLayerChannel', () => {
  const key = {}
  afterEach(() => {
    markerLayerChannel.remove(key)
    markerLayerChannel.attach(null)
  })

  test('moving a marker keeps its version, so native does not snapshot it again', async () => {
    const [first] = await sent(() => markerLayerChannel.set(key, 7, [1, 2], 300, true))
    const [moved] = await sent(() => markerLayerChannel.set(key, 7, [3, 4], 300, true))
    expect(moved).toEqual([7, 3, 4, versionOf(first), 300, 1])
  })

  test('a refresh or a new view bumps the version', async () => {
    const [first] = await sent(() => markerLayerChannel.set(key, 7, [1, 2], 300, false))
    const [refreshed] = await sent(() => markerLayerChannel.refresh(key))
    expect(versionOf(refreshed)).toBeGreaterThan(versionOf(first))
    const [remounted] = await sent(() => markerLayerChannel.set(key, 8, [1, 2], 300, false))
    expect(remounted.length).toBe(STRIDE)
    expect(versionOf(remounted)).toBeGreaterThan(versionOf(refreshed))
  })

  test('changes in one tick go out as one call', async () => {
    const other = {}
    const calls = await sent(() => {
      markerLayerChannel.set(key, 7, [1, 2], 300, true)
      markerLayerChannel.set(other, 9, [5, 6], 300, true)
      markerLayerChannel.refresh(key)
    })
    markerLayerChannel.remove(other)
    expect(calls.length).toBe(1)
    expect(calls[0].length).toBe(2 * STRIDE)
  })
})
