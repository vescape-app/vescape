import { beforeEach, expect, mock, test } from 'bun:test'
import type { BoardConfigChangeNotice } from 'vescape-core'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')

const pending = new Map<string, (notice: BoardConfigChangeNotice | null) => void>()
const getBoardConfigChangeNotice = mock(
  (boardId: string) =>
    new Promise<BoardConfigChangeNotice | null>((resolve) => pending.set(boardId, resolve)),
)

const vescapeCoreMock = { ...actualVescapeCore, getBoardConfigChangeNotice }
mock.module('vescape-core', () => vescapeCoreMock)
mock.module('../../modules/vescape-core/src/index', () => vescapeCoreMock)

beforeEach(async () => {
  pending.clear()
  getBoardConfigChangeNotice.mockClear()
  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  const { useBoardConfigChangeNoticeStore } =
    await import('@/modules/board/store/boardConfigChangeNoticeStore')
  useBoardStore.setState({ activeBoardId: null })
  useBoardConfigChangeNoticeStore.setState({ notice: null })
})

test('stale Board load cannot overwrite notice for newly selected Board', async () => {
  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  const { useBoardConfigChangeNoticeStore } =
    await import('@/modules/board/store/boardConfigChangeNoticeStore')
  const oldNotice: BoardConfigChangeNotice = { boardId: 'old', detectedAtMs: 1, diffs: [] }
  const newNotice: BoardConfigChangeNotice = { boardId: 'new', detectedAtMs: 2, diffs: [] }

  useBoardStore.setState({ activeBoardId: 'old' })
  const oldLoad = useBoardConfigChangeNoticeStore.getState().load('old')
  useBoardStore.setState({ activeBoardId: 'new' })
  const newLoad = useBoardConfigChangeNoticeStore.getState().load('new')
  pending.get('new')?.(newNotice)
  await newLoad
  pending.get('old')?.(oldNotice)
  await oldLoad

  expect(useBoardConfigChangeNoticeStore.getState().notice).toEqual(newNotice)
})
