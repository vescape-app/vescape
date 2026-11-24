import { expect, mock, test } from 'bun:test'

import type { BoardConfigValues } from 'vescape-core'

import { refreshBoardSnapshotAndProfiles } from '@/modules/tune/hooks/useTuneScreenData'

const boardConfig: BoardConfigValues = {
  capturedAtMs: 1000,
  boardId: 'board-1',
  refloatBaseVersion: '1.3.0',
  freshness: 'fresh',
  values: {},
  schemaHash: 'schema',
}

test('reloads compatible profiles after board config read', async () => {
  const readBoardConfig = mock(async () => boardConfig)
  const loadProfiles = mock(async (_boardId: string, _config: BoardConfigValues | null) => [])

  await refreshBoardSnapshotAndProfiles({
    boardConnected: true,
    selectedBoardId: 'board-1',
    readBoardConfig,
    loadProfiles,
  })

  expect(readBoardConfig).toHaveBeenCalledTimes(1)
  expect(loadProfiles).toHaveBeenCalledWith('board-1', boardConfig)
})

test('does not reload profiles when the config belongs to another board', async () => {
  const readBoardConfig = mock(async () => ({ ...boardConfig, boardId: 'board-2' }))
  const loadProfiles = mock(async (_boardId: string) => [])

  await refreshBoardSnapshotAndProfiles({
    boardConnected: true,
    selectedBoardId: 'board-1',
    readBoardConfig,
    loadProfiles,
  })

  expect(loadProfiles).not.toHaveBeenCalled()
})

test('does not read board config until firmware commands are trusted', async () => {
  const readBoardConfig = mock(async () => boardConfig)
  const loadProfiles = mock(async (_boardId: string, _config: BoardConfigValues | null) => [])

  await refreshBoardSnapshotAndProfiles({
    boardConnected: true,
    firmwareCommandsTrusted: false,
    selectedBoardId: 'board-1',
    readBoardConfig,
    loadProfiles,
  })

  expect(readBoardConfig).not.toHaveBeenCalled()
  expect(loadProfiles).not.toHaveBeenCalled()
})
