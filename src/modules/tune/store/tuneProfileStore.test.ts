import { beforeEach, expect, mock, test } from 'bun:test'

import type { BoardConfigSchemaField, BoardConfigValues, TuneProfile } from 'vescape-core'

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

const boardSnapshot: BoardConfigValues = {
  capturedAtMs: 1000,
  boardId: 'board-1',
  refloatBaseVersion: '1.3.0',
  freshness: 'fresh',
  schemaHash: 'schema',
  values: {
    kp: 24,
  },
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
const copyProfileToBoard = mock(async () => profile)
const applyBoardConfigChangeset = mock(async () => boardSnapshot)
const pushProfileToBoard = mock(async () => boardSnapshot)

const vescBleMock = {
  ...actualVescapeCore,
  getTuneProfiles,
  getTuneProfile,
  saveProfile,
  createProfile,
  renameProfile,
  deleteProfile,
  copyProfileToBoard,
  applyBoardConfigChangeset,
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
  applyBoardConfigChangeset.mockClear()
  applyBoardConfigChangeset.mockImplementation(async () => boardSnapshot)
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
  useTuneProfileStore.getState().setBoardConfig(boardSnapshot)
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

test('a successful profile retry clears the previous modal error', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')
  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  createProfile.mockImplementationOnce(async () => {
    throw new Error('disk unavailable')
  })

  await expect(
    useTuneProfileStore.getState().createProfile('Trail', 'mountains', 'green'),
  ).rejects.toThrow('disk unavailable')
  expect(useTuneProfileStore.getState().error).toBe('disk unavailable')

  await useTuneProfileStore.getState().createProfile('Trail', 'mountains', 'green')
  expect(useTuneProfileStore.getState().error).toBeNull()
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
  useTuneProfileStore.getState().setBoardConfig({
    capturedAtMs: 1000,
    boardId: 'board-1',
    refloatBaseVersion: '1.3.0',
    freshness: 'fresh',
    schemaHash: 'schema',
    values: {
      kp: 22,
      atr_strength_up: 1.2,
    },
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
  useTuneProfileStore.getState().setBoardConfig({
    capturedAtMs: 1000,
    boardId: 'board-1',
    refloatBaseVersion: '1.3.0',
    freshness: 'fresh',
    schemaHash: 'schema',
    values: {
      angle_p: 0.026,
    },
  })

  expect(useTuneProfileStore.getState().boardDiff).toEqual([])
  expect(useTuneProfileStore.getState().hasBoardDiff).toBe(false)
})

test('does not mark board-only snapshot fields as board diffs', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setBoardConfig({
    capturedAtMs: 1000,
    boardId: 'board-1',
    refloatBaseVersion: '1.3.0',
    freshness: 'fresh',
    schemaHash: 'schema',
    values: {
      kp: 20,
      new_board_field: 1,
    },
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
  useTuneProfileStore.getState().setBoardConfig({
    capturedAtMs: 1000,
    boardId: 'board-1',
    refloatBaseVersion: '1.3.0',
    freshness: 'fresh',
    schemaHash: 'schema',
    values: {
      kp: 22,
    },
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
  useTuneProfileStore.getState().setBoardConfig({
    capturedAtMs: 1000,
    boardId: 'board-1',
    refloatBaseVersion: '1.3.0',
    freshness: 'fresh',
    schemaHash: 'schema',
    values: {
      kp: 22,
      new_board_field: 1,
    },
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

test('preserves edits made while a profile save is in flight', async () => {
  let finish!: (value: TuneProfile) => void
  saveProfile.mockImplementationOnce(
    () => new Promise<TuneProfile>((resolve) => (finish = resolve)),
  )
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')
  useTuneProfileStore.setState({ activeProfile: profile, profiles: [profile] })
  useTuneProfileStore.getState().setDraftField('kp', 21)

  const saving = useTuneProfileStore.getState().saveActiveProfile()
  useTuneProfileStore.getState().setDraftField('kp', 22)
  finish({ ...profile, fields: { ...profile.fields, kp: 21 } })
  await saving

  expect(useTuneProfileStore.getState().draftFields).toEqual({ kp: 22 })
  expect(useTuneProfileStore.getState().hasDirtyFields).toBe(true)
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

test('syncToBoard pushes the profile natively when fields differ from the board', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')
  const { useTuneSnapshotStore } = await import('@/modules/tune/store/tuneSnapshotStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setBoardConfig(boardSnapshot)
  await useTuneProfileStore.getState().syncToBoard()

  expect(pushProfileToBoard).toHaveBeenCalledWith('profile-1')
  expect(useTuneSnapshotStore.getState().status).toBe('ready')
  expect(useTuneSnapshotStore.getState().boardConfig).toEqual(boardSnapshot)
  expect(useTuneProfileStore.getState().boardDiff).toEqual([
    { fieldId: 'kp', profileValue: 20, boardValue: 24 },
  ])
})

test('syncToBoard skips the native push when the board already matches', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  await useTuneProfileStore.getState().syncToBoard()

  expect(pushProfileToBoard).not.toHaveBeenCalled()
})

test('Save & sync applies only the dirty fields as a changeset, not board drift', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setBoardConfig(boardSnapshot)
  useTuneProfileStore.getState().setDraftField('atr_strength_up', 1.5)
  await useTuneProfileStore.getState().saveAndSyncActiveProfile()

  expect(saveProfile).toHaveBeenCalledWith('profile-1', { kp: 20, atr_strength_up: 1.5 })
  expect(applyBoardConfigChangeset).toHaveBeenCalledWith('board-1', { atr_strength_up: 1.5 })
  expect(pushProfileToBoard).not.toHaveBeenCalled()
  expect(useTuneProfileStore.getState().pendingBoardChangeset).toBeNull()
})

test('failed Save & sync preserves exact pending changeset for retry without pushing board drift', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setBoardConfig(boardSnapshot)
  useTuneProfileStore.getState().setDraftField('atr_strength_up', 1.5)

  applyBoardConfigChangeset.mockImplementationOnce(async () => {
    throw Object.assign(new Error('not idle'), { code: 'BOARD_NOT_IDLE' })
  })

  await expect(useTuneProfileStore.getState().saveAndSyncActiveProfile()).rejects.toThrow(
    'not idle',
  )

  expect(useTuneProfileStore.getState().hasDirtyFields).toBe(false)
  expect(useTuneProfileStore.getState().pendingBoardChangeset).toEqual({
    profileId: 'profile-1',
    boardId: 'board-1',
    changes: { atr_strength_up: 1.5 },
  })

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  expect(useTuneProfileStore.getState().pendingBoardChangeset).toEqual({
    profileId: 'profile-1',
    boardId: 'board-1',
    changes: { atr_strength_up: 1.5 },
  })

  applyBoardConfigChangeset.mockClear()
  await useTuneProfileStore.getState().retryPendingBoardSync()

  expect(applyBoardConfigChangeset).toHaveBeenCalledWith('board-1', { atr_strength_up: 1.5 })
  expect(pushProfileToBoard).not.toHaveBeenCalled()
  expect(useTuneProfileStore.getState().pendingBoardChangeset).toBeNull()
})

test('discardPendingBoardSync clears preserved changeset and error', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')

  await useTuneProfileStore.getState().loadProfiles('board-1', '1.3.0')
  useTuneProfileStore.getState().setBoardConfig(boardSnapshot)
  useTuneProfileStore.getState().setDraftField('atr_strength_up', 1.5)
  applyBoardConfigChangeset.mockImplementationOnce(async () => {
    throw Object.assign(new Error('disconnected'), { code: 'BOARD_NOT_CONNECTED' })
  })

  await expect(useTuneProfileStore.getState().saveAndSyncActiveProfile()).rejects.toThrow(
    'disconnected',
  )
  expect(useTuneProfileStore.getState().pendingBoardChangeset).not.toBeNull()

  useTuneProfileStore.getState().discardPendingBoardSync()
  expect(useTuneProfileStore.getState().pendingBoardChangeset).toBeNull()
  expect(useTuneProfileStore.getState().error).toBeNull()
})

test('wire-precision comparison distinguishes ki below 3 decimals and collapses sub-LSB kp drift', async () => {
  const { sameFieldValue } = await import('@/modules/tune/store/tuneProfileHelpers')
  const makeField = (
    id: string,
    type: BoardConfigSchemaField['type'],
    scale: number | null = null,
  ): BoardConfigSchemaField => ({
    id,
    type,
    xmlType: 1,
    vTx: 7,
    label: id,
    unit: null,
    min: null,
    max: null,
    offset: 0,
    scale,
    step: null,
    editorDecimals: null,
    editorScale: null,
    editAsPercentage: false,
    enumNames: [],
    defaultValue: null,
    transmittable: true,
    showDisplay: false,
    cDefine: null,
    description: null,
  })
  const schemaFields = new Map<string, BoardConfigSchemaField>([
    ['ki', makeField('ki', 'float16_scaled', 100000)],
    ['kp', makeField('kp', 'float16_scaled', 10)],
    ['turntilt_start_erpm', makeField('turntilt_start_erpm', 'uint16', null)],
  ])

  expect(sameFieldValue('ki', 0.0001, 0.0002, schemaFields)).toBe(false)
  expect(sameFieldValue('ki', 0.0001, 0.000104, schemaFields)).toBe(true)
  expect(sameFieldValue('kp', 20.0, 20.04, schemaFields)).toBe(true)
  expect(sameFieldValue('kp', 20.0, 20.1, schemaFields)).toBe(false)
  expect(sameFieldValue('turntilt_start_erpm', 1000, 1000.4, schemaFields)).toBe(true)
  expect(sameFieldValue('turntilt_start_erpm', 1000, 1001, schemaFields)).toBe(false)
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
  useTuneProfileStore.getState().setBoardConfig(boardSnapshot)
  await useTuneProfileStore.getState().syncToBoard()

  expect(pushProfileToBoard).not.toHaveBeenCalled()
  expect(useTuneProfileStore.getState().error).toBe('Re-link board before firmware commands.')
})

test('keeps saved tunes visible when INFO v2 adds patch and suffix on the same board', async () => {
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')
  const stored = [
    { ...profile, id: 'legacy', refloatBaseVersion: '1.2' },
    { ...profile, id: 'patch', refloatBaseVersion: '1.2.7-postfix' },
    { ...profile, id: 'other-minor', refloatBaseVersion: '1.20.0' },
    { ...profile, id: 'other-major', refloatBaseVersion: '2.2.0' },
    { ...otherBoardProfile, refloatBaseVersion: '1.2.7' },
  ]
  getTuneProfiles.mockImplementation(async () => stored)
  await useTuneProfileStore.getState().loadProfiles('board-1', '1.2')
  expect(useTuneProfileStore.getState().profiles.map((item) => item.id)).toEqual([
    'legacy',
    'patch',
  ])
  await useTuneProfileStore.getState().loadProfiles('board-1', '1.2.99-new-postfix')
  expect(useTuneProfileStore.getState().profiles.map((item) => item.id)).toEqual([
    'legacy',
    'patch',
  ])
})
