import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import { reactNativeStub } from '../../testSetup'
import type { AppDataChangedEvent } from 'vescape-core'

const actualVescapeCore = await import('@/../modules/vescape-core/src/index')

let capturedCb: ((event: AppDataChangedEvent) => void) | null = null
const remove = mock(() => {})
const addAppDataChangedListener = mock((cb: (event: AppDataChangedEvent) => void) => {
  capturedCb = cb
  return { remove }
})

mock.module('vescape-core', () => ({ ...actualVescapeCore, addAppDataChangedListener }))
mock.module('../../modules/vescape-core/src/index', () => ({
  ...actualVescapeCore,
  addAppDataChangedListener,
}))

let capturedAppStateCb: ((state: string) => void) | null = null
const appStateRemove = mock(() => {})
const appStateAdd = mock((_event: string, cb: (state: string) => void) => {
  capturedAppStateCb = cb
  return { remove: appStateRemove }
})

mock.module('react-native', () => ({
  ...reactNativeStub,
  AppState: { addEventListener: appStateAdd },
}))
mock.module('expo-file-system', () => ({
  Directory: class {
    exists = true
    create() {}
    delete() {
      this.exists = false
    }
  },
  File: class {
    uri = ''
    exists = false
    constructor(...parts: unknown[]) {
      this.uri = parts.map(String).join('/')
    }
    delete() {
      this.exists = false
    }
    async copy() {}
  },
  Paths: { document: 'file:///document' },
}))

const boardLoad = mock(async () => {})
const settingsLoad = mock(async () => {})

// The stores are module singletons shared across test files, so any `load` override must be undone
// afterwards or it leaks into other suites (e.g. settingsStore.test) as a silent no-op.
let restore: () => void = () => {}

beforeEach(async () => {
  capturedCb = null
  capturedAppStateCb = null
  remove.mockClear()
  appStateRemove.mockClear()
  boardLoad.mockClear()
  settingsLoad.mockClear()
  const { useBoardStore } = await import('@/modules/board/store/boardStore')
  const { useSettingsStore } = await import('@/modules/settings/store/settingsStore')
  const origBoardLoad = useBoardStore.getState().load
  const origSettingsLoad = useSettingsStore.getState().load
  restore = () => {
    useBoardStore.setState({ load: origBoardLoad })
    useSettingsStore.setState({ load: origSettingsLoad })
  }
  useBoardStore.setState({ load: boardLoad })
  useSettingsStore.setState({ load: settingsLoad })
})

afterEach(() => restore())

test('boards scope reloads only the board store', async () => {
  const { startAppDataSync } = await import('@/bootstrap/appDataSync')
  startAppDataSync()

  capturedCb?.({ scope: 'boards' })

  expect(boardLoad).toHaveBeenCalledTimes(1)
  expect(settingsLoad).not.toHaveBeenCalled()
})

test('settings scope reloads only the settings store', async () => {
  const { startAppDataSync } = await import('@/bootstrap/appDataSync')
  startAppDataSync()

  capturedCb?.({ scope: 'settings' })

  expect(settingsLoad).toHaveBeenCalledTimes(1)
  expect(boardLoad).not.toHaveBeenCalled()
})

test('returning to the foreground reloads every store (missed-push catch-up, #174)', async () => {
  const { startAppDataSync } = await import('@/bootstrap/appDataSync')
  startAppDataSync()

  capturedAppStateCb?.('active')

  expect(boardLoad).toHaveBeenCalledTimes(1)
  expect(settingsLoad).toHaveBeenCalledTimes(1)
})

test('non-active app state transitions do not reload', async () => {
  const { startAppDataSync } = await import('@/bootstrap/appDataSync')
  startAppDataSync()

  capturedAppStateCb?.('background')
  capturedAppStateCb?.('inactive')

  expect(boardLoad).not.toHaveBeenCalled()
  expect(settingsLoad).not.toHaveBeenCalled()
})

test('stop unsubscribes both the native and app-state listeners', async () => {
  const { startAppDataSync } = await import('@/bootstrap/appDataSync')
  const stop = startAppDataSync()

  stop()

  expect(remove).toHaveBeenCalledTimes(1)
  expect(appStateRemove).toHaveBeenCalledTimes(1)
})
