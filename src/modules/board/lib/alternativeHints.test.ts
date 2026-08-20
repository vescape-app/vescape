import { describe, expect, it } from 'bun:test'
import type { PresenceObservation } from 'vescape-core'

import {
  ALTERNATIVE_HINT_TTL_MS,
  alternativeHints,
  nextAlternativeHint,
} from '@/modules/board/lib/alternativeHints'

const observation = (
  boardId: string,
  observedAt: number,
  selected = false,
): PresenceObservation => ({
  boardId,
  bleId: `ble:${boardId}`,
  name: boardId.toUpperCase(),
  rssi: -60,
  observedAt,
  selected,
})

const input = (
  observations: PresenceObservation[],
  overrides: Partial<Parameters<typeof alternativeHints>[0]> = {},
) => ({
  observations,
  selectedBoardId: 'selected',
  connectedBoardId: null,
  dismissedBoardIds: [] as string[],
  now: 1_000,
  ...overrides,
})

describe('alternativeHints', () => {
  it('offers non-selected Boards in discovery order', () => {
    const hints = alternativeHints(
      input([observation('selected', 0, true), observation('b', 100), observation('c', 200)]),
    )
    expect(hints.map((h) => h.boardId)).toEqual(['b', 'c'])
  })

  it('never offers the selected Board, even if native mislabels the flag', () => {
    const hints = alternativeHints(input([observation('selected', 100)]))
    expect(hints).toEqual([])
  })

  it('drops an observation thirty seconds after its last advertisement', () => {
    const hints = (now: number) => alternativeHints(input([observation('b', 0)], { now }))
    expect(hints(ALTERNATIVE_HINT_TTL_MS - 1)).toHaveLength(1)
    expect(hints(ALTERNATIVE_HINT_TTL_MS)).toHaveLength(0)
  })

  it('clears the whole queue once a Board Session connects', () => {
    const hints = alternativeHints(
      input([observation('b', 100), observation('c', 200)], { connectedBoardId: 'selected' }),
    )
    expect(hints).toEqual([])
  })

  it('treats dismissal as a local acknowledgement that reveals the next Board', () => {
    const observations = [observation('b', 100), observation('c', 200)]
    expect(nextAlternativeHint(input(observations))?.boardId).toBe('b')
    expect(nextAlternativeHint(input(observations, { dismissedBoardIds: ['b'] }))?.boardId).toBe(
      'c',
    )
    expect(nextAlternativeHint(input(observations, { dismissedBoardIds: ['b', 'c'] }))).toBeNull()
  })

  it('shows one hint at a time', () => {
    expect(nextAlternativeHint(input([]))).toBeNull()
    expect(
      nextAlternativeHint(input([observation('b', 100), observation('c', 200)]))?.boardId,
    ).toBe('b')
  })
})
