import { describe, expect, test } from 'bun:test'
import { createPublicRideInteraction } from './publicRideInteraction'

function cell<T>(value: T) {
  return {
    get: () => value,
    set: (next: T) => {
      value = next
    },
  }
}

function harness() {
  const preview = cell(2)
  const initial = cell(2)
  const active = cell(false)
  const commits: number[] = []
  const interaction = createPublicRideInteraction({
    preview,
    initial,
    active,
    indexAt: (x) => x,
    onCommit: (stop) => commits.push(stop),
  })
  return { preview, initial, active, commits, ...interaction }
}

describe('public ride drag commit boundary', () => {
  test('a long scrub previews locally and commits only its final detent once', () => {
    const drag = harness()
    drag.begin(1, 0)
    for (let sample = 0; sample < 1000; sample++) drag.move(sample % 14, 0)
    drag.move(12, 0)
    expect(drag.preview.get()).toBe(12)
    expect(drag.commits).toEqual([])
    drag.finish(true)
    drag.finish(true)
    expect(drag.commits).toEqual([12])
    expect(drag.active.get()).toBe(false)
  })

  test('interrupted gestures restore the committed selection without sending an intent', () => {
    const drag = harness()
    drag.begin(7, 0)
    drag.move(13, 0)
    drag.finish(false)
    expect(drag.preview.get()).toBe(2)
    expect(drag.commits).toEqual([])
  })

  test('invalid samples and returning to the original stop do not write to the owner', () => {
    const drag = harness()
    drag.begin(-1, 0)
    expect(drag.preview.get()).toBe(2)
    drag.move(8, 0)
    drag.move(2, 0)
    drag.finish(true)
    expect(drag.commits).toEqual([])
  })
})

test('rapid Always → Off → Always preserves both intents before the owner rerenders', () => {
  const drag = harness()
  drag.initial.set(13)
  drag.preview.set(13)
  drag.begin(0, 0)
  drag.finish(true)
  expect(drag.initial.get()).toBe(0)
  drag.begin(13, 0)
  drag.finish(true)
  expect(drag.commits).toEqual([0, 13])
  expect(drag.preview.get()).toBe(13)
})

test('a cancelled follow-up gesture restores the latest accepted tap, not stale props', () => {
  const drag = harness()
  drag.initial.set(13)
  drag.preview.set(13)
  drag.begin(0, 0)
  drag.finish(true)
  drag.begin(7, 0)
  drag.finish(false)
  expect(drag.preview.get()).toBe(0)
  expect(drag.commits).toEqual([0])
})

test('continuation may leave the selector, but a gesture cannot start outside it', () => {
  const preview = cell(2)
  const initial = cell(2)
  const active = cell(false)
  const commits: number[] = []
  const drag = createPublicRideInteraction({
    preview,
    initial,
    active,
    indexAt: (x, y, continuing) => (!continuing && y < 0 ? -1 : x),
    onCommit: (stop) => commits.push(stop),
  })
  drag.begin(3, -100)
  drag.move(8, 10)
  drag.finish(true)
  expect(preview.get()).toBe(2)
  expect(commits).toEqual([])
  drag.begin(3, 10)
  drag.move(8, -100)
  expect(preview.get()).toBe(8)
  drag.finish(true)
  expect(commits).toEqual([8])
})
