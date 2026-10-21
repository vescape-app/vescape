import { describe, expect, test } from 'bun:test'

import {
  formatAlertPresetSpec,
  parseAlertPresetSpec,
  presetSpecOption,
  formatGeigerAlertSound,
  formatSlotAlertSound,
  mySoundId,
  type GeigerLevel,
  formatTtsAlertSound,
  parseAlertSoundString,
  parseGeigerAlertSound,
  parseSlotAlertSound,
  parseTtsAlertSound,
  parseVoiceAlertSound,
  formatVoiceAlertSound,
  type VoiceAlertSound,
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

describe('parseVoiceAlertSound', () => {
  test.each([
    ['voice(critical):battery:10', { severity: 'critical', key: 'battery', value: 10 }],
    ['voice(info):motorTemp', { severity: 'info', key: 'motorTemp', value: null }],
    ['voice(warning):', { severity: 'warning', key: null, value: null }],
    ['voice:battery:-5.5', { severity: 'warning', key: 'battery', value: -5.5 }],
    ['voice(info):battery:x', { severity: 'info', key: 'battery', value: null }],
    ['tts(info):battery', null],
  ] satisfies [string, VoiceAlertSound | null][])('%p', (raw, expected) => {
    expect(parseVoiceAlertSound(raw)).toEqual(expected)
  })

  test('formats what it parses', () => {
    expect(formatVoiceAlertSound('info')).toBe('voice(info):')
    expect(formatVoiceAlertSound('critical', 'battery', 20)).toBe('voice(critical):battery:20')
    expect(parseVoiceAlertSound(formatVoiceAlertSound('warning', 'motorTemp', 95))).toEqual({
      severity: 'warning',
      key: 'motorTemp',
      value: 95,
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

describe('parseGeigerAlertSound', () => {
  test.each([
    ['geiger:soft', 'soft'],
    ['geiger:mid', 'mid'],
    ['geiger:hard', 'hard'],
    ['geiger:loud', 'soft'],
    ['geiger:my:abc', 'soft'],
    ['preset:tick', 'soft'],
    ['preset:tick_hard', 'mid'],
    ['preset:gamma', 'hard'],
    ['preset:sustained', 'hard'],
    ['alert:warning', null],
    ['preset:beep', null],
    ['default', null],
  ] satisfies [string, GeigerLevel | null][])('%p', (raw, expected) => {
    expect(parseGeigerAlertSound(raw)).toBe(expected)
  })

  test('round-trips through formatGeigerAlertSound', () => {
    expect(parseGeigerAlertSound(formatGeigerAlertSound('mid'))).toBe('mid')
  })
})

describe('mySoundId', () => {
  test.each([
    ['alert(3):my:beep', 'beep'],
    ['alert:my:beep', 'beep'],
    ['geiger:my:abc', 'abc'],
    ['alert(2):my:', null],
    ['alert:warning', null],
    ['geiger:soft', null],
    ['tts(warning):my:beep', null],
    ['my:beep', null],
  ] satisfies [string, string | null][])('%p', (raw, expected) => {
    expect(mySoundId(raw)).toBe(expected)
  })

  test('round-trips through formatSlotAlertSound', () => {
    expect(mySoundId(formatSlotAlertSound(2, 'my:beep'))).toBe('beep')
  })
})

// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/alerts/AlertSoundStringTest.kt `parsesAndRewritesPresetSpecs`
describe('parseAlertPresetSpec', () => {
  test.each([
    ['preset(normal)', { level: 'normal', options: [] }],
    [
      'preset(off):geiger=mid,match=on',
      {
        level: 'off',
        options: [
          ['geiger', 'mid'],
          ['match', 'on'],
        ],
      },
    ],
    ['preset(safe):future=a=b,bare,=x', { level: 'safe', options: [['future', 'a=b']] }],
    ['preset(normal):', { level: 'normal', options: [] }],
    ['preset:normal', null],
    ['geiger:mid', null],
  ])('%s', (raw, expected) => {
    expect(parseAlertPresetSpec(raw)).toEqual(expected as never)
  })

  test('reads options and round-trips unknown keys', () => {
    const spec = parseAlertPresetSpec('preset(off):geiger=mid,future=1')!
    expect(presetSpecOption(spec, 'geiger')).toBe('mid')
    expect(presetSpecOption(spec, 'match')).toBeNull()
    expect(formatAlertPresetSpec(spec)).toBe('preset(off):geiger=mid,future=1')
  })
})
