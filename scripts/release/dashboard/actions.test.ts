import { describe, expect, test } from 'bun:test'
import { availableActions, defaultActionIndex, type ActionId } from './actions'
import { initialReleaseState, type ProductionRow, type ReleaseState, type TrackRow } from './state'

const ids = (state: ReleaseState): ActionId[] => availableActions(state).map((action) => action.id)

const production = (overrides: Partial<ProductionRow> = {}): ProductionRow => ({
  marketingVersion: '1.7.1',
  phone: 1388,
  wear: 1389,
  detail: 'promoted',
  runId: 10,
  rolloutPercentage: 25,
  halted: false,
  openPromotionRunId: 99,
  age: '2h ago',
  ...overrides,
})

const internal = (): TrackRow => ({
  marketingVersion: '1.8.0',
  phone: 1420,
  wear: 1421,
  detail: 'uploaded',
  runId: 22,
  age: '1h ago',
})

const state = (overrides: Partial<ReleaseState> = {}): ReleaseState => ({
  ...initialReleaseState(),
  loading: false,
  ...overrides,
})

describe('availableActions', () => {
  test('offers only entry points when nothing is recorded yet', () => {
    expect(ids(state())).toEqual(['prepare', 'watch', 'build', 'refresh'])
  })

  test('offers open promotion once an internal build is not on open', () => {
    const actions = availableActions(
      state({
        pendingInternal: 1,
        internal: internal(),
      }),
    )
    expect(actions.map((action) => action.id)).toContain('promote-open')
    expect(actions.find((action) => action.id === 'promote-open')?.label).toContain('1.8.0')
  })

  test('hides open promotion when no internal build is waiting', () => {
    expect(
      ids(
        state({
          pendingInternal: 0,
          internal: internal(),
        }),
      ),
    ).not.toContain('promote-open')
  })

  test('offers advance and halt while a staged rollout is live', () => {
    const available = ids(state({ production: production() }))
    expect(available).toContain('advance')
    expect(available).toContain('halt')
    expect(available).not.toContain('resume')
  })

  test('offers resume instead of advance while halted', () => {
    const available = ids(state({ production: production({ halted: true }) }))
    expect(available).toContain('resume')
    expect(available).not.toContain('advance')
    expect(available).not.toContain('halt')
  })

  test('offers no rollout controls at full rollout', () => {
    const available = ids(state({ production: production({ rolloutPercentage: 100 }) }))
    expect(available).not.toContain('advance')
    expect(available).not.toContain('halt')
    expect(available).not.toContain('resume')
    expect(available).toContain('status')
  })

  test('leads with preparing but preselects a running release so Enter watches it', () => {
    const running = state({
      activeRun: {
        id: 5,
        run_number: 42,
        html_url: '',
        display_title: '',
        status: 'in_progress',
        conclusion: null,
      },
      pendingInternal: 1,
      internal: internal(),
    })
    const actions = availableActions(running)
    expect(actions[0]?.id).toBe('prepare')
    const preselected = actions[defaultActionIndex(actions, running)]
    expect(preselected?.id).toBe('watch')
    expect(preselected?.label).toContain('#42')
    expect(defaultActionIndex(availableActions(state()), state())).toBe(0)
  })
})
