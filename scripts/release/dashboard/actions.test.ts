import { describe, expect, test } from 'bun:test'
import { availableActions, defaultActionIndex, moreActions, type ActionId } from './actions'
import { initialReleaseState, type ProductionRow, type ReleaseState, type TrackRow } from './state'

const ids = (state: ReleaseState): ActionId[] => availableActions(state).map((action) => action.id)

const production = (overrides: Partial<ProductionRow> = {}): ProductionRow => ({
  marketingVersion: '1.7.1',
  phone: 1388,
  wear: 1389,
  detail: 'promoted',
  runId: 10,
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
    expect(ids(state())).toEqual(['prepare', 'more', 'exit'])
    expect(moreActions(state()).map((action) => action.id)).toEqual([
      'watch',
      'build',
      'choose-open',
      'choose-production',
      'technical',
      'refresh',
    ])
  })

  test('offers open promotion once an internal build is not on open', () => {
    const actions = availableActions(
      state({
        internal: internal(),
        promotableInternalRunId: 22,
      }),
    )
    expect(actions.map((action) => action.id)).toContain('promote-open')
    expect(actions.find((action) => action.id === 'promote-open')?.label).toContain('1.8.0')
  })

  test('hides open promotion when no internal build is waiting', () => {
    expect(
      ids(
        state({
          internal: internal(),
        }),
      ),
    ).not.toContain('promote-open')
  })

  test('keeps live status refresh under more options', () => {
    expect(moreActions(state({ production: production() })).map((action) => action.id)).toContain(
      'status',
    )
  })

  test('offers no production action before anything reaches production', () => {
    expect(ids(state())).not.toContain('status')
  })

  test('leads with the running release', () => {
    const running = state({
      activeRun: {
        id: 5,
        run_number: 42,
        html_url: '',
        display_title: '',
        status: 'in_progress',
        conclusion: null,
      },
      internal: internal(),
    })
    const actions = availableActions(running)
    expect(actions[0]?.id).toBe('watch')
    const preselected = actions[defaultActionIndex(actions, running)]
    expect(preselected?.id).toBe('watch')
    expect(preselected?.label).toContain('running Internal release')
    expect(defaultActionIndex(availableActions(state()), state())).toBe(0)
  })

  test('does not offer promotion when the latest internal manifest fails current checks', () => {
    const actions = availableActions(
      state({
        internal: internal(),
        promotableInternalRunId: null,
        guidance: 'Rebuild it first.',
        devVersion: '1.8.0',
      }),
    )
    expect(actions.map((action) => action.id)).toEqual(['prepare', 'more', 'exit'])
  })

  test('resumes a prepared version that has not reached Internal', () => {
    const actions = availableActions(
      state({
        devVersion: '1.9.0',
        preparedVersion: '1.9.0',
        internal: internal(),
        promotableInternalRunId: 22,
      }),
    )
    expect(actions[0]).toEqual({
      id: 'continue-prepared',
      label: 'Build 1.9.0 for Internal',
    })
  })

  test('resumes an unaccepted draft before offering a new release', () => {
    const actions = availableActions(
      state({ draft: { version: '1.8.1', bump: 'patch' }, internal: internal() }),
    )
    expect(actions[0]).toEqual({ id: 'resume-draft', label: 'Resume draft 1.8.1' })
  })

  test('makes a newer failed Internal run the next thing to resolve', () => {
    const actions = availableActions(
      state({
        failedRun: {
          id: 30,
          html_url: 'https://example.test/run/30',
          display_title: 'release',
          status: 'completed',
          conclusion: 'failure',
        },
      }),
    )
    expect(actions[0]?.label).toContain('failed Internal release')
  })
})
