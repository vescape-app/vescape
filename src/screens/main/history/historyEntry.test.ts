import { expect, mock, test } from 'bun:test'

import type { HistorySession } from '@/modules/history/store/historyStore'
import { openHistoryTarget } from '@/screens/main/history/historyEntry'

function session(id: string): HistorySession {
  return { id } as HistorySession
}

test('opening a specific ride replaces the latest ride with the clicked identity', async () => {
  const latest = session('latest')
  const selected = session('selected')
  const state: { openFavoriteId: string | null; selectedSession: HistorySession } = {
    openFavoriteId: 'old-favorite',
    selectedSession: latest,
  }

  await openHistoryTarget(
    { kind: 'ride', session: selected },
    {
      enterHistory: () => {},
      setHistoryTab: () => {},
      openFavorite: () => {},
      closeFavorite: () => {
        state.openFavoriteId = null
      },
      setHistorySheetVisible: () => {},
      setOpenMediaAssetId: () => {},
      selectSession: mock(async (ride) => {
        state.selectedSession = ride
      }),
    },
  )

  expect(state.openFavoriteId).toBeNull()
  expect(state.selectedSession.id).toBe('selected')
})

test('opening a Favorite keeps its id and route session as one target', async () => {
  const selected = session('favorite:fav-2')
  const state: {
    openFavoriteId: string | null
    selectedSession: HistorySession | null
  } = { openFavoriteId: null, selectedSession: null }

  await openHistoryTarget(
    { kind: 'favorite', favoriteId: 'fav-2', session: selected },
    {
      enterHistory: () => {},
      setHistoryTab: () => {},
      openFavorite: (id) => {
        state.openFavoriteId = id
      },
      closeFavorite: () => {
        state.openFavoriteId = null
      },
      setHistorySheetVisible: () => {},
      setOpenMediaAssetId: () => {},
      selectSession: async (ride) => {
        state.selectedSession = ride
      },
    },
  )

  expect(state.openFavoriteId).toBe('fav-2')
  expect(state.selectedSession?.id).toBe('favorite:fav-2')
})
