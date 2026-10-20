import { createProfile, getTuneProfiles, renameProfile, saveProfile } from 'vescape-core'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'
import { DEFAULT_RING_ANCHORS } from '@/modules/tune/lib/ringCalibration'
import { ringSectionPatch } from '@/modules/tune/lib/ringModel'

/** Emulator-only fixtures use real native profile storage, never a mock profile library. */
export async function seedTuneEditor() {
  if (process.env.EXPO_PUBLIC_E2E !== '1') throw new Error('Tune fixtures require E2E mode')
  const boardId = 'e2e-tune-board'
  await useBoardStore.getState().load()
  if (!useBoardStore.getState().boards.some((board) => board.id === boardId)) {
    await useBoardStore.getState().addBoard({
      id: boardId,
      name: 'E2E Tune Board',
      link: { bleId: 'E2:E2:E2:E2:E2:03', transport: 'direct', refloatBaseVersion: '1.2' },
    })
  }
  const profiles = await getTuneProfiles(boardId, '1.2')
  for (const [name, color, value] of [
    ['E2E Rings', 'purple', 5],
    ['E2E Trail', 'cyan', 6],
  ] as const) {
    const fields = Object.assign(
      {},
      ...[0, 1, 2].map((section) =>
        ringSectionPatch(DEFAULT_RING_ANCHORS, section, [value, value, value]),
      ),
    )
    const existing = profiles.find((profile) => profile.name === name)
    if (existing) {
      if (existing.color !== color) await renameProfile(existing.id, name, existing.icon, color)
      if (Object.entries(fields).some(([id, fieldValue]) => existing.fields[id] !== fieldValue))
        await saveProfile(existing.id, fields)
    } else await createProfile(boardId, name, 'sliders-horizontal', color, fields, '1.2')
  }
  useBoardStore.getState().setActiveBoard(boardId)
  await useTuneProfileStore.getState().loadProfiles(boardId, '1.2')
  const main = useTuneProfileStore
    .getState()
    .profiles.find((profile) => profile.name === 'E2E Rings')
  if (main) useTuneProfileStore.getState().setActiveProfile(main.id)
  await useSettingsStore.getState().set('tuneEditorMode', 'rings')
}

/** Offline onboarding fixture has no reported firmware or downloaded config. */
export async function seedOfflineTuneEditor() {
  if (process.env.EXPO_PUBLIC_E2E !== '1') throw new Error('Tune fixtures require E2E mode')
  const boardId = 'e2e-offline-tune-board'
  await useBoardStore.getState().load()
  if (!useBoardStore.getState().boards.some((board) => board.id === boardId)) {
    await useBoardStore.getState().addBoard({
      id: boardId,
      name: 'E2E Offline Tune Board',
      link: { bleId: 'E2:E2:E2:E2:E2:04', transport: 'direct' },
    })
  }
  useTuneProfileStore.getState().clear()
  useBoardStore.getState().setActiveBoard(boardId)
  await useSettingsStore.getState().set('tuneEditorMode', 'rings')
}
