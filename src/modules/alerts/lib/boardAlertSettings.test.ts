import { describe, expect, test } from 'bun:test'
import type { Board } from 'vescape-core'

import { boardPinnedPresetCount, boardPresetPins } from '@/modules/alerts/lib/boardAlertSettings'

const board = (values: Partial<Board>) => ({ id: 'b', name: 'B', link: null, ...values }) as Board

describe('preset sound pins', () => {
  test('unknown pack ids read as Default', () => {
    const pins = boardPresetPins(
      board({
        alertPresetSound: { battery: { effects: 'gone', voice: 'hev', geiger: 'geiger:mid' } },
      }),
      'battery',
    )
    expect(pins).toEqual({ voice: 'hev' })
  })

  test('counts only sounding presets with a pin', () => {
    const counted = board({
      alertPreset: { battery: 'normal', speed: 'off', duty: 'custom', 'motor-temp': 'safe' },
      alertPresetSound: {
        battery: { effects: 'hev' },
        speed: { effects: 'hev' },
        duty: { voice: 'clean' },
        'motor-temp': { geiger: 'geiger:hard' },
      },
    })
    expect(boardPinnedPresetCount(counted)).toBe(1)
  })
})
