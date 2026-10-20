import { beforeEach, expect, test } from 'bun:test'
import { useRingMappingNoticeStore as store } from './ringMappingNoticeStore'

beforeEach(() => store.setState({ owner: null, acknowledged: false }))

test('many mounted editors share one popup and one dismissal closes it for all', () => {
  for (let index = 0; index < 100; index++) store.getState().claim(`editor-${index}`)
  expect(store.getState().owner).toBe('editor-0')
  store.getState().dismiss('editor-0')
  for (let index = 0; index < 100; index++) store.getState().claim(`remounted-${index}`)
  expect(store.getState().owner).toBeNull()
  expect(store.getState().acknowledged).toBe(true)
})

test('a hidden editor releases presentation without acknowledging; stale owners cannot dismiss another popup', () => {
  store.getState().claim('old')
  store.getState().release('old')
  store.getState().claim('focused')
  store.getState().dismiss('old')
  store.getState().release('old')
  expect(store.getState().owner).toBe('focused')
  expect(store.getState().acknowledged).toBe(false)
  store.getState().dismiss('focused')
  expect(store.getState().owner).toBeNull()
})
