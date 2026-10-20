import { describe, expect, test } from 'bun:test'

import {
  formatSlotAlertSound,
  formatTtsAlertSound,
  parseAlertSoundString,
  parseSlotAlertSound,
  parseTtsAlertSound,
  type SlotAlertSound,
  type TtsAlertSound,
} from '@/modules/alerts/lib/alertSoundString'

describe('parseAlertSoundString', () => {
  test.each([
    ['tts(info):Battery low', { kind: 'tts', variant: 'info', sound: 'Battery low' }],
    ['tts:Battery low', { kind: 'tts', variant: null, sound: 'Battery low' }],
    ['tts():x', { kind: 'tts', variant: null, sound: 'x' }],
    ['tts(critical):Time: 12:30', { kind: 'tts', variant: 'critical', sound: 'Time: 12:30' }],
    ['tts:', { kind: 'tts', variant: null, sound: '' }],
    ['alert(3):my:beep', { kind: 'alert', variant: '3', sound: 'my:beep' }],
    ['preset:beep', { kind: 'preset', variant: null, sound: 'beep' }],
    ['default', null],
    ['Tts:x', null],
    ['tts(warning:x', null],
    ['', null],
  ])('%p', (raw, expected) => {
    expect(parseAlertSoundString(raw)).toEqual(expected)
  })
})

describe('parseTtsAlertSound', () => {
  test.each([
    ['tts(info):a', { severity: 'info', text: 'a' }],
    ['tts(warning):a', { severity: 'warning', text: 'a' }],
    ['tts(critical):a: b', { severity: 'critical', text: 'a: b' }],
    ['tts:a', { severity: 'warning', text: 'a' }],
    ['tts(loud):a', { severity: 'warning', text: 'a' }],
    ['preset:beep', null],
    ['default', null],
  ] satisfies [string, TtsAlertSound | null][])('%p', (raw, expected) => {
    expect(parseTtsAlertSound(raw)).toEqual(expected)
  })

  test('round-trips text containing colons', () => {
    expect(parseTtsAlertSound(formatTtsAlertSound('critical', 'At 12:30: stop'))).toEqual({
      severity: 'critical',
      text: 'At 12:30: stop',
    })
  })
})

describe('parseSlotAlertSound', () => {
  test.each([
    ['alert(3):warning', { count: 3, severity: 'warning' }],
    ['alert(1):critical', { count: 1, severity: 'critical' }],
    ['alert:info', { count: 1, severity: 'info' }],
    ['alert(9):info', { count: 5, severity: 'info' }],
    ['alert(0):info', { count: 1, severity: 'info' }],
    ['alert(x):critical', { count: 1, severity: 'critical' }],
    ['alert(2):my:beep', { count: 2, severity: 'warning' }],
    ['alert(2):loud', { count: 2, severity: 'warning' }],
    ['preset:beep', { count: 1, severity: 'warning' }],
    ['preset:urgent', { count: 1, severity: 'critical' }],
    ['preset:notify', { count: 1, severity: 'info' }],
    ['default', { count: 1, severity: 'warning' }],
    ['nonsense', { count: 1, severity: 'warning' }],
  ] satisfies [string, SlotAlertSound][])('%p', (raw, expected) => {
    expect(parseSlotAlertSound(raw)).toEqual(expected)
  })

  test('round-trips through formatSlotAlertSound', () => {
    expect(parseSlotAlertSound(formatSlotAlertSound(4, 'critical'))).toEqual({
      count: 4,
      severity: 'critical',
    })
  })
})
