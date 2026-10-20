import { describe, expect, test } from 'bun:test'

import {
  formatTtsAlertSound,
  parseAlertSoundString,
  parseTtsAlertSound,
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
