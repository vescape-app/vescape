import { beforeEach, expect, mock, test } from 'bun:test'

import type { BoardConfigSchema, BoardConfigValues, MotorConfigValues } from 'vescape-core'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')

const boardConfig: BoardConfigValues = {
  capturedAtMs: 1000,
  boardId: 'board-1',
  refloatBaseVersion: '1.3.0',
  freshness: 'fresh',
  values: { kp: 20 },
  schemaHash: 'schema',
}

const refreshBoardConfigValues = mock(async () => boardConfig)
const getLastKnownBoardConfigValues = mock(
  async (_boardId: string) => null as BoardConfigValues | null,
)
const getLastKnownMotorConfigValues = mock(
  async (_boardId: string) => null as MotorConfigValues | null,
)

const vescBleMock = {
  ...actualVescapeCore,
  refreshBoardConfigValues,
  getLastKnownBoardConfigValues,
  getLastKnownMotorConfigValues,
}

mock.module('vescape-core', () => vescBleMock)
mock.module('../../modules/vescape-core/src/index', () => vescBleMock)

beforeEach(async () => {
  refreshBoardConfigValues.mockClear()
  refreshBoardConfigValues.mockImplementation(async () => boardConfig)
  getLastKnownBoardConfigValues.mockReset()
  getLastKnownBoardConfigValues.mockImplementation(async () => null)
  getLastKnownMotorConfigValues.mockReset()
  getLastKnownMotorConfigValues.mockImplementation(async () => null)
  const { useBleStore } = await import('@/modules/board/store/bleStore')
  const { useBoardConfigValuesStore } = await import('@/modules/board/store/boardConfigValuesStore')
  const { useTuneSnapshotStore } = await import('@/modules/tune/store/tuneSnapshotStore')
  useBleStore.setState({ linkIntegrity: 'trusted' })
  useBoardConfigValuesStore.setState({ values: null, lastKnown: null, error: null })
  useTuneSnapshotStore.setState({ status: 'idle', boardConfig: null, error: null })
  useTuneSnapshotStore.getState().clear()
})

test('last-known config mirrors ignore an older board read after a board switch', async () => {
  const { useBoardConfigValuesStore } = await import('@/modules/board/store/boardConfigValuesStore')
  const { useMotorConfigValuesStore } = await import('@/modules/board/store/motorConfigValuesStore')
  const boardB = {
    boardId: 'board-b',
    refloatBaseVersion: null,
    capturedAtMs: 2,
    freshness: 'fresh' as const,
    values: {},
  }
  const motorB: MotorConfigValues = {
    boardId: 'board-b',
    signature: 1,
    firmware: 'release_6_05',
    capturedAtMs: 2,
    freshness: 'fresh',
    values: {},
  }
  let rejectOldBoard!: (error: Error) => void
  let rejectOldMotor!: (error: Error) => void
  getLastKnownBoardConfigValues
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOldBoard = reject
        }),
    )
    .mockImplementationOnce(async () => boardB)
  getLastKnownMotorConfigValues
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOldMotor = reject
        }),
    )
    .mockImplementationOnce(async () => motorB)

  const oldBoardRead = useBoardConfigValuesStore.getState().loadLastKnown('board-a')
  const oldMotorRead = useMotorConfigValuesStore.getState().loadLastKnown('board-a')
  await Promise.all([
    useBoardConfigValuesStore.getState().loadLastKnown('board-b'),
    useMotorConfigValuesStore.getState().loadLastKnown('board-b'),
  ])
  rejectOldBoard(new Error('old board failed'))
  rejectOldMotor(new Error('old motor failed'))
  await Promise.all([oldBoardRead, oldMotorRead])

  expect(useBoardConfigValuesStore.getState()).toMatchObject({ lastKnown: boardB, error: null })
  expect(useMotorConfigValuesStore.getState()).toMatchObject({ lastKnown: motorB, error: null })
})

test('joins concurrent board config reads', async () => {
  const { useTuneSnapshotStore } = await import('@/modules/tune/store/tuneSnapshotStore')
  let resolveRead: ((config: BoardConfigValues) => void) | undefined
  refreshBoardConfigValues.mockImplementation(
    () =>
      new Promise<BoardConfigValues>((resolve) => {
        resolveRead = resolve
      }),
  )

  const first = useTuneSnapshotStore.getState().read()
  const second = useTuneSnapshotStore.getState().read()

  expect(refreshBoardConfigValues).toHaveBeenCalledTimes(1)
  expect(useTuneSnapshotStore.getState().status).toBe('loading')

  resolveRead?.(boardConfig)
  await Promise.all([first, second])

  expect(useTuneSnapshotStore.getState().status).toBe('ready')
  expect(useTuneSnapshotStore.getState().boardConfig).toEqual(boardConfig)
})

test('stores read errors without keeping stale board configs', async () => {
  const { useTuneSnapshotStore } = await import('@/modules/tune/store/tuneSnapshotStore')
  await useTuneSnapshotStore.getState().read()
  refreshBoardConfigValues.mockImplementation(async () => {
    throw new Error('Timed out reading Refloat config')
  })

  await useTuneSnapshotStore.getState().read()

  expect(useTuneSnapshotStore.getState().status).toBe('error')
  expect(useTuneSnapshotStore.getState().boardConfig).toBeNull()
  expect(useTuneSnapshotStore.getState().error).toBe('Timed out reading Refloat config')
})

test('clear invalidates an in-flight read and permits a fresh read', async () => {
  const { useTuneSnapshotStore } = await import('@/modules/tune/store/tuneSnapshotStore')
  const staleConfig = { ...boardConfig, capturedAtMs: 1000 }
  const freshConfig = { ...boardConfig, capturedAtMs: 2000 }
  let resolveStale: ((config: BoardConfigValues) => void) | undefined
  let resolveFresh: ((config: BoardConfigValues) => void) | undefined
  refreshBoardConfigValues
    .mockImplementationOnce(
      () =>
        new Promise<BoardConfigValues>((resolve) => {
          resolveStale = resolve
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<BoardConfigValues>((resolve) => {
          resolveFresh = resolve
        }),
    )

  const staleRead = useTuneSnapshotStore.getState().read()
  useTuneSnapshotStore.getState().clear()
  const freshRead = useTuneSnapshotStore.getState().read()

  expect(refreshBoardConfigValues).toHaveBeenCalledTimes(2)

  resolveStale?.(staleConfig)
  await staleRead
  expect(useTuneSnapshotStore.getState().status).toBe('loading')
  expect(useTuneSnapshotStore.getState().read()).toBe(freshRead)

  resolveFresh?.(freshConfig)
  await freshRead

  expect(useTuneSnapshotStore.getState().status).toBe('ready')
  expect(useTuneSnapshotStore.getState().boardConfig).toEqual(freshConfig)
})

test('setBoardConfig stores a pushed board config', async () => {
  const { useTuneSnapshotStore } = await import('@/modules/tune/store/tuneSnapshotStore')

  useTuneSnapshotStore.getState().setBoardConfig(boardConfig)

  expect(useTuneSnapshotStore.getState().status).toBe('ready')
  expect(useTuneSnapshotStore.getState().boardConfig).toEqual(boardConfig)
  expect(useTuneSnapshotStore.getState().error).toBeNull()
})

test.each([
  ['checking', 'Checking trusted board link.'],
  ['outdated', 'Re-link board before firmware commands.'],
  ['mismatched', 'Connected board does not match saved link.'],
] as const)('blocks board config reads while link is %s', async (linkIntegrity, message) => {
  const { useBleStore } = await import('@/modules/board/store/bleStore')
  const { useTuneSnapshotStore } = await import('@/modules/tune/store/tuneSnapshotStore')
  useBleStore.setState({ linkIntegrity })

  await useTuneSnapshotStore.getState().read()

  expect(refreshBoardConfigValues).not.toHaveBeenCalled()
  expect(useTuneSnapshotStore.getState().status).toBe('error')
  expect(useTuneSnapshotStore.getState().error).toBe(message)
})

test('keeps the displayed config while a re-read is in flight', async () => {
  const { useTuneSnapshotStore } = await import('@/modules/tune/store/tuneSnapshotStore')
  await useTuneSnapshotStore.getState().read()
  refreshBoardConfigValues.mockImplementation(() => new Promise<BoardConfigValues>(() => {}))

  void useTuneSnapshotStore.getState().read()

  expect(useTuneSnapshotStore.getState().status).toBe('loading')
  expect(useTuneSnapshotStore.getState().boardConfig).toEqual(boardConfig)
})

test('drops the board config when the Board Session ends', async () => {
  const { useBoardConfigValuesStore } = await import('@/modules/board/store/boardConfigValuesStore')
  const { startTuneSnapshotSessionSync, useTuneSnapshotStore } =
    await import('@/modules/tune/store/tuneSnapshotStore')
  const stop = startTuneSnapshotSessionSync()
  useBoardConfigValuesStore.getState().replace(boardConfig)
  await useTuneSnapshotStore.getState().read()

  useBoardConfigValuesStore.getState().replace(null)

  expect(useTuneSnapshotStore.getState().status).toBe('idle')
  expect(useTuneSnapshotStore.getState().boardConfig).toBeNull()
  stop()
})

test('recomputes tune profile board drift when BoardConfigValues.schema arrives', async () => {
  const { useBoardConfigValuesStore } = await import('@/modules/board/store/boardConfigValuesStore')
  const { useTuneProfileStore } = await import('@/modules/tune/store/tuneProfileStore')
  const { startTuneSnapshotSessionSync } = await import('@/modules/tune/store/tuneSnapshotStore')
  const stop = startTuneSnapshotSessionSync()

  useTuneProfileStore.setState({
    activeProfile: {
      id: 'p1',
      boardId: 'board-1',
      refloatBaseVersion: '1.3.0',
      name: 'Main',
      icon: 'faders',
      color: 'sky',
      fields: { kp: 20.04 },
      createdAt: 1,
      updatedAt: 1,
    },
    boardFields: { kp: 20.0 },
    boardDiff: [{ fieldId: 'kp', profileValue: 20.04, boardValue: 20.0 }],
    hasBoardDiff: true,
    draftFields: {},
    hasDirtyFields: false,
  })

  const schema: BoardConfigSchema = {
    hash: 's1',
    fields: [
      {
        id: 'kp',
        type: 'float16_scaled',
        xmlType: 1,
        vTx: 7,
        label: 'Angle P',
        unit: null,
        min: 0,
        max: 40,
        offset: 0,
        scale: 10,
        step: 1,
        editorDecimals: 1,
        editorScale: null,
        editAsPercentage: false,
        enumNames: [],
        defaultValue: 20,
        transmittable: true,
        showDisplay: false,
        cDefine: null,
        description: null,
      },
    ],
    groups: [],
  }

  useBoardConfigValuesStore.getState().replace({ ...boardConfig, schemaHash: 's1', schema })

  expect(useTuneProfileStore.getState().boardDiff).toEqual([])
  expect(useTuneProfileStore.getState().hasBoardDiff).toBe(false)
  stop()
})
