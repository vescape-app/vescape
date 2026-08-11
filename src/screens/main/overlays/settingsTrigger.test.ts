import { describe, expect, test } from 'bun:test'
import { settingsTriggerState } from './settingsTrigger'
import { theme } from '@/constants/theme'

const IDLE = { kind: 'idle', lastUploadAtMs: null } as const
const SYNCING = { kind: 'syncing', current: 3, total: 12 } as const

describe('settingsTriggerState', () => {
  test('rests as a plain gear with nothing happening', () => {
    const state = settingsTriggerState({
      versionWarning: false,
      updateAvailable: false,
      backup: IDLE,
    })
    expect(state.takeover).toBeNull()
    expect(state.dot).toBeUndefined()
  })

  test('badges an available update without taking the button over', () => {
    const state = settingsTriggerState({
      versionWarning: false,
      updateAvailable: true,
      backup: IDLE,
    })
    expect(state.takeover).toBeNull()
    expect(state.dot).toBe(theme.status.upgrade.color)
    expect(state.accessibilityLabel).toBe('Settings, update available')
  })

  test('wears the upgrade arrow when the version is warned or blocked', () => {
    const state = settingsTriggerState({
      versionWarning: true,
      updateAvailable: true,
      backup: SYNCING,
    })
    expect(state.takeover).toBe('update')
    expect(state.accent).toBe(theme.status.upgrade.color)
    // A required update outranks a running backup, so the dot does not double up on it.
    expect(state.dot).toBeUndefined()
  })

  test('wears backup with its progress, keeping an available update as a dot', () => {
    const state = settingsTriggerState({
      versionWarning: false,
      updateAvailable: true,
      backup: SYNCING,
    })
    expect(state.takeover).toBe('backup')
    expect(state.accent).toBe(theme.settingsIcon.sync)
    expect(state.progress).toBeCloseTo(0.25)
    expect(state.dot).toBe(theme.status.upgrade.color)
  })

  test('omits progress for a backlog it cannot measure', () => {
    const state = settingsTriggerState({
      versionWarning: false,
      updateAvailable: false,
      backup: { kind: 'syncing', current: 0, total: 0 },
    })
    expect(state.takeover).toBe('backup')
    expect(state.progress).toBeUndefined()
  })
})
