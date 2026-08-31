import { beforeEach, expect, mock, test } from 'bun:test'
import type { Board } from 'vescape-core'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')

let persistedBoards: Board[] = []

const getBoards = mock(async () => persistedBoards)
const getSettings = mock(async () => ({
  liveHistoryLimit: 5,
  autoConnect: true,
  autoRecording: false,
  selectedBoardId: null,
  lastGpsLatitude: null,
  lastGpsLongitude: null,
  movingSpeedThresholdKmh: 3,
  rideSplitGapMinutes: 30,
  freeSpinMaxSpeedDeltaKmh: 10,
  freeSpinStationaryBoardCapKmh: 15,
  mapStyleKey: 'onedark',
  satelliteOverlayEnabled: true,
  satelliteImageryOpacity: 0.2,
  satelliteMapImageryOpacity: 1,
  satelliteImagerySaturation: -0.35,
  hideTelemetryMapDetails: true,
  mapOrientationMode: 'northUp',
  historyMetricGradientsEnabled: true,
  historyMetricHotRanges: {},
}))
const setSelectedBoard = mock(() => {})
const upsertBoard = mock(async (board: Board) => {
  persistedBoards = [...persistedBoards.filter((b) => b.id !== board.id), board]
})
const deleteBoard = mock(async (id: string) => {
  persistedBoards = persistedBoards.filter((b) => b.id !== id)
})

const vescBleMock = {
  ...actualVescapeCore,
  getBoards,
  getSettings,
  setSelectedBoard,
  upsertBoard,
  deleteBoard,
}

mock.module('vescape-core', () => vescBleMock)
mock.module('../../modules/vescape-core/src/index', () => vescBleMock)

beforeEach(async () => {
  persistedBoards = []
  getBoards.mockClear()
  getSettings.mockClear()
  setSelectedBoard.mockClear()
  upsertBoard.mockClear()
  deleteBoard.mockClear()
  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  useBoardStore.setState({
    boards: [],
    activeBoardId: null,
    hasLoaded: false,
  })
})

test('new boards default to Molicel P50B 20S2P preset battery config', async () => {
  const { DEFAULT_BATTERY_CONFIG, useBoardStore } = await import('@/modules/board/store/boardStore')

  const board = useBoardStore.getState().addBoard({ name: 'ADV' })

  expect(board.batteryConfig).toEqual(DEFAULT_BATTERY_CONFIG)
  expect(upsertBoard).toHaveBeenCalledWith(
    expect.objectContaining({ batteryConfig: DEFAULT_BATTERY_CONFIG }),
  )
})

test('new boards start unlinked (no Board Link)', async () => {
  const { useBoardStore } = await import('@/modules/board/store/boardStore')

  const board = useBoardStore.getState().addBoard({ name: 'ADV' })

  expect(board.link).toBeNull()
  expect(upsertBoard).toHaveBeenCalledWith(expect.objectContaining({ link: null }))
})

test('new boards can be created with a draft Board Link', async () => {
  const { useBoardStore } = await import('@/modules/board/store/boardStore')

  const board = useBoardStore
    .getState()
    .addBoard({ name: 'ADV', link: { bleId: 'AA:BB', transport: 36 } })

  expect(board.link).toEqual({ bleId: 'AA:BB', transport: 36 })
  expect(upsertBoard).toHaveBeenCalledWith(
    expect.objectContaining({ link: { bleId: 'AA:BB', transport: 36 } }),
  )
})

test('new boards retain a preallocated id used during Board Link finalization', async () => {
  const { useBoardStore } = await import('@/modules/board/store/boardStore')

  const board = useBoardStore.getState().addBoard({ id: 'probe-board', name: 'ADV' })

  expect(board.id).toBe('probe-board')
  expect(upsertBoard).toHaveBeenCalledWith(expect.objectContaining({ id: 'probe-board' }))
})

test('stored Board Link survives a store reload from native boards', async () => {
  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  const board: Board = {
    id: 'board-1',
    name: 'ADV',
    description: null,
    createdAt: 1,
    deletedAt: null,
    batteryConfig: null,
    link: null,
  }

  useBoardStore.setState({ boards: [board], activeBoardId: board.id, hasLoaded: true })
  await useBoardStore.getState().updateBoard({ ...board, link: { bleId: 'AA:BB', transport: 12 } })
  useBoardStore.setState({ boards: [], activeBoardId: null, hasLoaded: false })
  await useBoardStore.getState().load()

  expect(useBoardStore.getState().boards[0]?.link).toEqual({ bleId: 'AA:BB', transport: 12 })
})

test('new boards can use manual battery config', async () => {
  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  const batteryConfig = { mode: 'manual' as const, minVoltage: 60, maxVoltage: 84 }

  const board = useBoardStore.getState().addBoard({ name: 'ADV', batteryConfig })

  expect(board.batteryConfig).toEqual(batteryConfig)
  expect(upsertBoard).toHaveBeenCalledWith(expect.objectContaining({ batteryConfig }))
})

test('updated battery config survives a store reload from native boards', async () => {
  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  const board: Board = {
    id: 'board-1',
    name: 'ADV',
    description: null,
    createdAt: 1,
    deletedAt: null,
    batteryConfig: {
      mode: 'preset',
      cellPresetId: 'molicel:21700:p50b',
      seriesCount: 20,
      parallelCount: 2,
    },
    link: null,
  }
  const batteryConfig = { mode: 'manual' as const, minVoltage: 58, maxVoltage: 82 }

  useBoardStore.setState({ boards: [board], activeBoardId: board.id, hasLoaded: true })
  await useBoardStore.getState().updateBoard({ ...board, batteryConfig })
  useBoardStore.setState({ boards: [], activeBoardId: null, hasLoaded: false })
  await useBoardStore.getState().load()

  expect(useBoardStore.getState().boards[0]?.batteryConfig).toEqual(batteryConfig)
  expect(upsertBoard).toHaveBeenCalledWith(expect.objectContaining({ batteryConfig }))
})
