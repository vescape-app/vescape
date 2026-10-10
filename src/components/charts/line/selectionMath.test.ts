import { expect, test } from 'bun:test'

import { moveSelectionEdge, pickSelectionEdge } from '@/components/charts/line/selectionMath'

const RANGE = { startMs: 1_000, endMs: 3_000 }
const DOMAIN = { domainStartMs: 0, domainEndMs: 4_000 }
const PLOT = { plotWidth: 100, viewportSpanMs: 4_000 }

test('the half of the selection a touch lands in owns the drag', () => {
  expect(pickSelectionEdge(10, 20, 80)).toBe('start')
  expect(pickSelectionEdge(49, 20, 80)).toBe('start')
  expect(pickSelectionEdge(51, 20, 80)).toBe('end')
  expect(pickSelectionEdge(200, 20, 80)).toBe('end')
})

test('an edge moves by translation from where it started, not to the finger', () => {
  const moved = moveSelectionEdge({
    edge: 'start',
    range: RANGE,
    originMs: RANGE.startMs,
    translationX: 10,
    ...PLOT,
    ...DOMAIN,
  })
  expect(moved).toEqual({ startMs: 1_400, endMs: 3_000 })
})

test('an edge stops at the opposite one rather than crossing it', () => {
  expect(
    moveSelectionEdge({
      edge: 'start',
      range: RANGE,
      originMs: RANGE.startMs,
      translationX: 90,
      ...PLOT,
      ...DOMAIN,
    }),
  ).toEqual({ startMs: 3_000, endMs: 3_000 })

  expect(
    moveSelectionEdge({
      edge: 'end',
      range: RANGE,
      originMs: RANGE.endMs,
      translationX: -90,
      ...PLOT,
      ...DOMAIN,
    }),
  ).toEqual({ startMs: 1_000, endMs: 1_000 })
})

test('an edge dragged past the data stops at the domain', () => {
  expect(
    moveSelectionEdge({
      edge: 'start',
      range: RANGE,
      originMs: RANGE.startMs,
      translationX: -999,
      ...PLOT,
      ...DOMAIN,
    }).startMs,
  ).toBe(0)

  expect(
    moveSelectionEdge({
      edge: 'end',
      range: RANGE,
      originMs: RANGE.endMs,
      translationX: 999,
      ...PLOT,
      ...DOMAIN,
    }).endMs,
  ).toBe(4_000)
})

test('a zoomed-in plot moves fewer ms per pixel dragged', () => {
  const zoomed = moveSelectionEdge({
    edge: 'start',
    range: RANGE,
    originMs: RANGE.startMs,
    translationX: 10,
    plotWidth: 100,
    viewportSpanMs: 400,
    ...DOMAIN,
  })
  expect(zoomed.startMs).toBe(1_040)
})
