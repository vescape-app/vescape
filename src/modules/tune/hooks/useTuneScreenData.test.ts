import { expect, mock, test } from 'bun:test'

import type { RefloatConfigSnapshot } from 'vescape-core'

import { refreshBoardSnapshotAndProfiles } from '@/modules/tune/hooks/useTuneScreenData'

const snapshot: RefloatConfigSnapshot = {
  capturedAt: 1000,
  boardId: 'board-1',
  canId: 1,
  schemaHash: 'schema',
  rawConfigHash: 'raw',
  rawConfigLength: 8,
  fwVersion: 'FW 6.05',
  refloatBaseVersion: '1.3.0',
  missingFieldIds: [],
  groups: [],
}

test('reloads compatible profiles after board snapshot read', async () => {
  const readBoardSnapshot = mock(async () => snapshot)
  const loadProfiles = mock(async (_boardId: string, _snapshot: RefloatConfigSnapshot | null) => [])

  await refreshBoardSnapshotAndProfiles({
    boardConnected: true,
    selectedBoardId: 'board-1',
    readBoardSnapshot,
    loadProfiles,
  })

  expect(readBoardSnapshot).toHaveBeenCalledTimes(1)
  expect(loadProfiles).toHaveBeenCalledWith('board-1', snapshot)
})

test('does not reload profiles when the snapshot belongs to another board', async () => {
  const readBoardSnapshot = mock(async () => ({ ...snapshot, boardId: 'board-2' }))
  const loadProfiles = mock(async (_boardId: string) => [])

  await refreshBoardSnapshotAndProfiles({
    boardConnected: true,
    selectedBoardId: 'board-1',
    readBoardSnapshot,
    loadProfiles,
  })

  expect(loadProfiles).not.toHaveBeenCalled()
})

test('does not read board snapshot until firmware commands are trusted', async () => {
  const readBoardSnapshot = mock(async () => snapshot)
  const loadProfiles = mock(async (_boardId: string, _snapshot: RefloatConfigSnapshot | null) => [])

  await refreshBoardSnapshotAndProfiles({
    boardConnected: true,
    firmwareCommandsTrusted: false,
    selectedBoardId: 'board-1',
    readBoardSnapshot,
    loadProfiles,
  })

  expect(readBoardSnapshot).not.toHaveBeenCalled()
  expect(loadProfiles).not.toHaveBeenCalled()
})

test('fresh board retry does not reload profiles or reset an existing draft', async () => {
  const readBoardSnapshot = mock(async () => snapshot)
  const loadProfiles = mock(async () => [])
  await refreshBoardSnapshotAndProfiles({
    boardConnected: true,
    firmwareCommandsTrusted: true,
    selectedBoardId: 'board-1',
    preserveDraft: () => true,
    readBoardSnapshot,
    loadProfiles,
  })
  expect(readBoardSnapshot).toHaveBeenCalledTimes(1)
  expect(loadProfiles).not.toHaveBeenCalled()
})

test('a profile opened during an automatic read is preserved when that read finishes', async () => {
  let finish!: (value: RefloatConfigSnapshot) => void
  let profileOpened = false
  const readBoardSnapshot = mock(
    () =>
      new Promise<RefloatConfigSnapshot>((resolve) => {
        finish = resolve
      }),
  )
  const loadProfiles = mock(async () => [])
  const request = refreshBoardSnapshotAndProfiles({
    boardConnected: true,
    selectedBoardId: 'board-1',
    preserveDraft: () => profileOpened,
    readBoardSnapshot,
    loadProfiles,
  })
  profileOpened = true
  finish(snapshot)
  await request
  expect(loadProfiles).not.toHaveBeenCalled()
})
