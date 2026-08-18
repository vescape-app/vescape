import { beforeEach, expect, mock, test } from 'bun:test'

import type { RefloatConfigSnapshot, TuneProfile } from 'vescape-core'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')

const profile: TuneProfile = {
  id: 'profile-1',
  boardId: 'board-1',
  refloatBaseVersion: '1.3.0',
  name: 'Main',
  icon: 'sliders-horizontal',
  color: 'purple',
  fields: {
    kp: 20,
    atr_strength_up: 1.2,
  },
  createdAt: 1000,
  updatedAt: 1000,
}

const otherBoardProfile: TuneProfile = {
  id: 'profile-2',
  boardId: 'board-2',
  refloatBaseVersion: '1.3.0',
  name: 'Other',
  icon: 'faders',
  color: 'sky',
  fields: {
    kp: 30,
  },
  createdAt: 1000,
  updatedAt: 1000,
}

const boardSnapshot: RefloatConfigSnapshot = {
  capturedAt: 1000,
  boardId: 'board-1',
  canId: 1,
  schemaHash: 'schema',
  rawConfigHash: 'raw',
  rawConfigLength: 8,
  fwVersion: 'FW 6.05',
  refloatBaseVersion: '1.3.0',
  missingFieldIds: [],
  groups: [
    {
      id: 'general',
      title: 'General',
      fields: [
        {
          id: 'kp',
          label: 'Angle P',
          value: 24,
          unit: null,
          min: 0,
          max: 50,
        },
      ],
    },
  ],
}

const getTuneProfiles = mock(async (_boardId: string) => [profile])
const getTuneProfile = mock(async () => profile)
const saveProfile = mock(async (_profileId: string, fields: TuneProfile['fields']) => ({
  ...profile,
  fields,
  updatedAt: 2000,
}))
const createProfile = mock(async () => profile)
const renameProfile = mock(async () => profile)
const deleteProfile = mock(async () => {})
const getProfileHistory = mock(async () => [])
const rollbackProfile = mock(async () => profile)
const copyProfileToBoard = mock(async () => profile)
const pushProfileToBoard = mock(async () => boardSnapshot)

const vescBleMock = {
  ...actualVescapeCore,
  getTuneProfiles,
  getTuneProfile,
  saveProfile,
  createProfile,
  renameProfile,
  deleteProfile,
  getProfileHistory,
  rollbackProfile,
  copyProfileToBoard,
  pushProfileToBoard,
}

mock.module('vescape-core', () => vescBleMock)
mock.module('../../modules/vescape-core/src/index', () => vescBleMock)

beforeEach(async () => {
  getTuneProfiles.mockClear()
  getTuneProfiles.mockImplementation(async (_boardId: string) => [profile])
  getTuneProfile.mockClear()
  saveProfile.mockClear()
  createProfile.mockClear()
  createProfile.mockImplementation(async () => profile)
  renameProfile.mockClear()
  renameProfile.mockImplementation(async () => profile)
  pushProfileToBoard.mockClear()
  pushProfileToBoard.mockImplementation(async () => boardSnapshot)
  const { useBleStore } = await import('@/modules/board/store/bleStore')
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')
  const { useTuneSnapshotStore } = await import('@/modules/tune/store/tuneSnapshotStore')
  useBleStore.setState({ linkIntegrity: 'trusted' })
  useTuneProfileStore.setState({
    profiles: [],
    activeProfile: null,
    activeBoardId: null,
    refloatBaseVersion: null,
    draftFields: {},
    hasDirtyFields: false,
    boardFields: {},
    boardDiff: [],
    hasBoardDiff: false,
    loading: false,
    saving: false,
    syncing: false,
    error: null,
  })
  useTuneSnapshotStore.getState().clear()
})

test('tracks draft field edits as an overlay on the saved Tune Profile', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setDraftField('kp', 23)

  expect(useTuneProfileStore.getState().activeProfile?.fields.kp).toBe(20)
  expect(useTuneProfileStore.getState().draftFields).toEqual({ kp: 23 })
  expect(useTuneProfileStore.getState().hasDirtyFields).toBe(true)
  expect(useTuneProfileStore.getState().getDirtyFields()).toEqual({ kp: 23 })

  useTuneProfileStore.getState().revertField('kp')

  expect(useTuneProfileStore.getState().draftFields).toEqual({})
  expect(useTuneProfileStore.getState().hasDirtyFields).toBe(false)
})

test('loads and creates profiles scoped to normalized Refloat base compatibility', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setBoardSnapshot(boardSnapshot)
  await useTuneProfileStore.getState().createProfile('Main', '', '')

  expect(getTuneProfiles).toHaveBeenCalledWith('board-1', '1.3.0')
  expect(createProfile).toHaveBeenCalledWith(
    'board-1',
    'Main',
    'sliders-horizontal',
    'purple',
    { kp: 24 },
    '1.3.0',
  )
})

test('clears stale same-board profiles while compatibility reloads', async () => {
  let resolveNext: (profiles: TuneProfile[]) => void = () => {}
  getTuneProfiles.mockImplementation(
    () =>
      new Promise<TuneProfile[]>((resolve) => {
        resolveNext = resolve
      }),
  )
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')
  useTuneProfileStore.setState({
    profiles: [profile],
    activeProfile: profile,
    activeBoardId: 'board-1',
    refloatBaseVersion: '1.3.0',
  })

  const load = useTuneProfileStore.getState().loadProfiles('board-1', '1.4.0')

  expect(useTuneProfileStore.getState().profiles).toEqual([])
  expect(useTuneProfileStore.getState().activeProfile).toBeNull()
  resolveNext([{ ...profile, id: 'profile-1.4', refloatBaseVersion: '1.4.0' }])
  await load

  expect(useTuneProfileStore.getState().profiles.map((item) => item.refloatBaseVersion)).toEqual([
    '1.4.0',
  ])
})

test('ignores loaded profile outside current compatibility', async () => {
  getTuneProfile.mockImplementation(async () => ({
    ...profile,
    id: 'profile-old',
    refloatBaseVersion: '1.2.0',
  }))
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  const loaded = await useTuneProfileStore.getState().loadProfile('profile-old')

  expect(loaded).toBeNull()
  expect(useTuneProfileStore.getState().activeProfile?.id).toBe('profile-1')
})

test('computes board diff against saved profile independently of draft edits', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setDraftField('kp', 25)
  useTuneProfileStore.getState().setBoardSnapshot({
    groups: [
      {
        id: 'general',
        title: 'General',
        fields: [
          {
            id: 'kp',
            label: 'Angle P',
            value: 22,
            unit: null,
            min: 0,
            max: 50,
          },
          {
            id: 'atr_strength_up',
            label: 'ATR Uphill Strength',
            value: 1.2,
            unit: null,
            min: 0,
            max: 2,
          },
        ],
      },
    ],
  })

  expect(useTuneProfileStore.getState().boardDiff).toEqual([
    { fieldId: 'kp', profileValue: 20, boardValue: 22 },
  ])
  expect(useTuneProfileStore.getState().hasBoardDiff).toBe(true)
  expect(useTuneProfileStore.getState().draftFields).toEqual({ kp: 25 })
})

test('does not mark rounded-equivalent board values as changed', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  getTuneProfiles.mockImplementation(async (_boardId: string) => [
    {
      ...profile,
      fields: {
        ...profile.fields,
        angle_p: 0.026000000536441803,
      },
    },
  ])

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setBoardSnapshot({
    groups: [
      {
        id: 'general',
        title: 'General',
        fields: [
          {
            id: 'angle_p',
            label: 'Angle P',
            value: 0.026,
            unit: null,
            min: 0,
            max: 1,
          },
        ],
      },
    ],
  })

  expect(useTuneProfileStore.getState().boardDiff).toEqual([])
  expect(useTuneProfileStore.getState().hasBoardDiff).toBe(false)
})

test('does not mark board-only snapshot fields as board diffs', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setBoardSnapshot({
    groups: [
      {
        id: 'general',
        title: 'General',
        fields: [
          {
            id: 'kp',
            label: 'Angle P',
            value: 20,
            unit: null,
            min: 0,
            max: 50,
          },
          {
            id: 'new_board_field',
            label: 'New Board Field',
            value: 1,
            unit: null,
            min: 0,
            max: 2,
          },
        ],
      },
    ],
  })

  expect(useTuneProfileStore.getState().boardDiff).toEqual([])
  expect(useTuneProfileStore.getState().hasBoardDiff).toBe(false)
})

test('does not keep rounded-equivalent draft values dirty', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  getTuneProfiles.mockImplementation(async (_boardId: string) => [
    {
      ...profile,
      fields: {
        ...profile.fields,
        angle_p: 0.026000000536441803,
      },
    },
  ])

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setDraftField('angle_p', 0.026)

  expect(useTuneProfileStore.getState().draftFields).toEqual({})
  expect(useTuneProfileStore.getState().hasDirtyFields).toBe(false)
  expect(useTuneProfileStore.getState().getDirtyFields()).toEqual({})
})

test('accepts board values into draft and saves through normal profile flow', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setBoardSnapshot({
    groups: [
      {
        id: 'general',
        title: 'General',
        fields: [
          {
            id: 'kp',
            label: 'Angle P',
            value: 22,
            unit: null,
            min: 0,
            max: 50,
          },
        ],
      },
    ],
  })

  useTuneProfileStore.getState().acceptBoardField('kp')

  expect(useTuneProfileStore.getState().draftFields).toEqual({ kp: 22 })
  expect(useTuneProfileStore.getState().hasDirtyFields).toBe(true)

  await useTuneProfileStore.getState().saveActiveProfile()

  expect(saveProfile).toHaveBeenCalledWith('profile-1', {
    kp: 22,
    atr_strength_up: 1.2,
  })
  expect(useTuneProfileStore.getState().boardDiff).toEqual([])
  expect(useTuneProfileStore.getState().hasBoardDiff).toBe(false)
})

test('accept all board values ignores board-only snapshot fields', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setBoardSnapshot({
    groups: [
      {
        id: 'general',
        title: 'General',
        fields: [
          {
            id: 'kp',
            label: 'Angle P',
            value: 22,
            unit: null,
            min: 0,
            max: 50,
          },
          {
            id: 'new_board_field',
            label: 'New Board Field',
            value: 1,
            unit: null,
            min: 0,
            max: 2,
          },
        ],
      },
    ],
  })

  useTuneProfileStore.getState().acceptAllBoardValues()

  expect(useTuneProfileStore.getState().draftFields).toEqual({ kp: 22 })
  expect(useTuneProfileStore.getState().hasDirtyFields).toBe(true)
})

test('saves dirty fields through native saveProfile and clears the draft', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setDraftField('kp', 24)
  await useTuneProfileStore.getState().saveActiveProfile()

  expect(saveProfile).toHaveBeenCalledWith('profile-1', {
    kp: 24,
    atr_strength_up: 1.2,
  })
  expect(useTuneProfileStore.getState().activeProfile?.fields.kp).toBe(24)
  expect(useTuneProfileStore.getState().draftFields).toEqual({})
  expect(useTuneProfileStore.getState().hasDirtyFields).toBe(false)
})

test('ignores stale profile loads when board selection changes', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')
  let resolveBoard1: ((profiles: TuneProfile[]) => void) | undefined
  let resolveBoard2: ((profiles: TuneProfile[]) => void) | undefined
  getTuneProfiles.mockImplementation(
    (boardId: string) =>
      new Promise<TuneProfile[]>((resolve) => {
        if (boardId === 'board-1') {
          resolveBoard1 = resolve
        } else {
          resolveBoard2 = resolve
        }
      }),
  )

  const staleLoad = useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  const currentLoad = useTuneProfileStore.getState().loadProfiles('board-2', '1.3.0')
  resolveBoard2?.([otherBoardProfile])
  await currentLoad

  expect(useTuneProfileStore.getState().activeBoardId).toBe('board-2')
  expect(useTuneProfileStore.getState().activeProfile?.id).toBe('profile-2')

  resolveBoard1?.([profile])
  await staleLoad

  expect(useTuneProfileStore.getState().activeBoardId).toBe('board-2')
  expect(useTuneProfileStore.getState().activeProfile?.id).toBe('profile-2')
  expect(useTuneProfileStore.getState().profiles).toEqual([otherBoardProfile])
})

test('syncToBoard updates tune snapshot store with pushed board snapshot', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')
  const { useTuneSnapshotStore } = await import('@/modules/tune/store/tuneSnapshotStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  await useTuneProfileStore.getState().syncToBoard()

  expect(pushProfileToBoard).toHaveBeenCalledWith('profile-1')
  expect(useTuneSnapshotStore.getState().status).toBe('ready')
  expect(useTuneSnapshotStore.getState().snapshot).toEqual(boardSnapshot)
  expect(useTuneProfileStore.getState().boardDiff).toEqual([
    { fieldId: 'kp', profileValue: 20, boardValue: 24 },
  ])
})

test('falls back to legacy native profile calls when the dev client has the old bridge', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')
  const legacyCreated = {
    ...profile,
    id: 'profile-legacy',
    name: 'Trail',
    icon: undefined,
    color: undefined,
  } as unknown as TuneProfile
  const legacyRenamed = {
    ...legacyCreated,
    name: 'Trail 2',
  }

  createProfile.mockImplementation(async (...args: unknown[]) => {
    if (args.length > 3) throw new Error('Expected 3 arguments')
    return legacyCreated
  })
  renameProfile.mockImplementation(async (...args: unknown[]) => {
    if (args.length > 2) throw new Error('Expected 2 arguments')
    return legacyRenamed as TuneProfile
  })

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  const created = await useTuneProfileStore.getState().createProfile('Trail', 'mountains', 'green')

  expect(created?.id).toBe('profile-legacy')
  expect(created?.icon).toBe('mountains')
  expect(created?.color).toBe('green')

  const renamed = await useTuneProfileStore
    .getState()
    .renameProfile('profile-legacy', 'Trail 2', 'rocket-launch', 'orange')

  expect(renamed?.name).toBe('Trail 2')
  expect(renamed?.icon).toBe('rocket-launch')
  expect(renamed?.color).toBe('orange')
})

test('syncToBoard blocks native push when link is outdated', async () => {
  const { useBleStore } = await import('@/modules/board/store/bleStore')
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')
  useBleStore.setState({ linkIntegrity: 'outdated' })

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  await useTuneProfileStore.getState().syncToBoard()

  expect(pushProfileToBoard).not.toHaveBeenCalled()
  expect(useTuneProfileStore.getState().error).toBe('Re-link board before firmware commands.')
})
