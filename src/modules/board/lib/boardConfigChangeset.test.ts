import { describe, expect, test } from 'bun:test'
import type { BoardConfigSchema, BoardConfigSchemaField } from 'vescape-core'

import {
  buildBoardConfigReviewEntries,
  clampBoardConfigFieldValue,
  formatBoardConfigFieldValue,
  getBoardConfigRebootNote,
  hasPendingBoardConfigChange,
  isInternalBoardConfigField,
  isRiskyBoardConfigField,
  resolveBoardConfigEditorKind,
} from '@/modules/board/lib/boardConfigChangeset'
import { resolveBoardConfigField } from '@/modules/board/lib/refloatFieldOverlay'

function makeField(overrides: Partial<BoardConfigSchemaField>): BoardConfigSchemaField {
  return {
    id: 'test_field',
    type: 'float32',
    xmlType: 1,
    vTx: 0,
    label: 'Test Field',
    unit: null,
    min: 0,
    max: 10,
    offset: 0,
    scale: null,
    step: 0.5,
    editorDecimals: 1,
    editorScale: 1,
    editAsPercentage: false,
    enumNames: [],
    defaultValue: 1,
    transmittable: true,
    showDisplay: false,
    cDefine: null,
    description: null,
    ...overrides,
  }
}

describe('boardConfigChangeset', () => {
  test('chooses the right editor kind from schema type and metadata', () => {
    expect(
      resolveBoardConfigEditorKind(resolveBoardConfigField(makeField({ type: 'bool' }), true)),
    ).toBe('switch')

    expect(
      resolveBoardConfigEditorKind(
        resolveBoardConfigField(
          makeField({ type: 'uint8', enumNames: ['Solid', 'Fade', 'Pulse'] }),
          0,
        ),
      ),
    ).toBe('enum')

    expect(
      resolveBoardConfigEditorKind(
        resolveBoardConfigField(
          makeField({ id: 'tiltback_duty', editAsPercentage: true, editorScale: 1, unit: null }),
          0.8,
        ),
      ),
    ).toBe('percentage')

    expect(
      resolveBoardConfigEditorKind(
        resolveBoardConfigField(
          makeField({ id: 'leds.front.brightness', editorScale: 100, unit: '%' }),
          0.5,
        ),
      ),
    ).toBe('percentage')

    expect(
      resolveBoardConfigEditorKind(resolveBoardConfigField(makeField({ unit: '°' }), 3.5)),
    ).toBe('number')

    expect(
      resolveBoardConfigEditorKind(
        resolveBoardConfigField(makeField({ id: 'meta.is_default', type: 'bool' }), false),
      ),
    ).toBe('readonly')
  })

  test('formats booleans, enums, percentages, temperatures, and numbers', () => {
    const boolField = resolveBoardConfigField(makeField({ type: 'bool' }), true)
    expect(formatBoardConfigFieldValue(boolField, true)).toBe('On')
    expect(formatBoardConfigFieldValue(boolField, false)).toBe('Off')

    const enumField = resolveBoardConfigField(
      makeField({ type: 'uint8', enumNames: ['None', 'UART', 'PPM'] }),
      1,
    )
    expect(formatBoardConfigFieldValue(enumField, 1)).toBe('UART')

    const pctField = resolveBoardConfigField(
      makeField({
        id: 'tiltback_duty',
        editAsPercentage: true,
        editorScale: 1,
        unit: null,
        step: 0.01,
        editorDecimals: 2,
      }),
      0.85,
    )
    expect(pctField.displayScale).toBe(100)
    expect(pctField.unit).toBe('%')
    expect(formatBoardConfigFieldValue(pctField, 0.85)).toBe('85%')

    const tempField = resolveBoardConfigField(
      makeField({ id: 'bms.cell_ht_threshold', unit: '°C', editorDecimals: 0 }),
      60,
    )
    expect(formatBoardConfigFieldValue(tempField, 60, 'celsius')).toBe('60 °C')
    expect(formatBoardConfigFieldValue(tempField, 60, 'fahrenheit')).toBe('140 °F')
  })

  test('flags risky fields and internal fields', () => {
    const schema: BoardConfigSchema = {
      hash: 'test',
      fields: [],
      groups: [
        {
          name: 'General',
          subgroups: [
            {
              name: 'Specs',
              items: [{ kind: 'field', fieldId: 'future_spec_field' }],
            },
          ],
        },
        {
          name: 'Internal',
          subgroups: [
            {
              name: 'Meta',
              items: [
                { kind: 'field', fieldId: 'meta.is_default' },
                { kind: 'field', fieldId: 'internal_future_flag' },
              ],
            },
          ],
        },
      ],
    }

    expect(isInternalBoardConfigField('meta.is_default', schema)).toBe(true)
    expect(isInternalBoardConfigField('internal_future_flag', schema)).toBe(true)
    expect(isRiskyBoardConfigField('meta.is_default', schema)).toBe(false)

    for (const riskyId of [
      'disabled',
      'fault_adc1',
      'fault_adc2',
      'fault_adc_half_erpm',
      'fault_delay_pitch',
      'fault_delay_roll',
      'fault_delay_switch_half',
      'fault_delay_switch_full',
      'inputtilt_remote_type',
      'future_spec_field',
    ]) {
      expect(isRiskyBoardConfigField(riskyId, schema)).toBe(true)
    }

    expect(isRiskyBoardConfigField('hardware.leds.mode', schema)).toBe(false)
    expect(isRiskyBoardConfigField('startup_simplestart_enabled', schema)).toBe(false)
  })

  test('returns reboot notes for hardware.leds.* and leds.on on Refloat 1.2+', () => {
    expect(getBoardConfigRebootNote('hardware.leds.pin', '1.2.1')).toBeTruthy()
    expect(getBoardConfigRebootNote('hardware.leds.front.count', '1.1.0')).toBeTruthy()
    expect(getBoardConfigRebootNote('leds.on', '1.2.1')).toBeTruthy()
    expect(getBoardConfigRebootNote('leds.on', '1.3.0')).toBeTruthy()
    expect(getBoardConfigRebootNote('leds.on', '1.1.5')).toBeNull()
    expect(getBoardConfigRebootNote('leds.front.brightness', '1.3.0')).toBeNull()
  })

  test('clamps numeric values to hard limits and rounds integers', () => {
    const intField = resolveBoardConfigField(makeField({ type: 'uint8', min: 0, max: 100 }), 50)
    expect(clampBoardConfigFieldValue(intField, 150)).toBe(100)
    expect(clampBoardConfigFieldValue(intField, -5)).toBe(0)
    expect(clampBoardConfigFieldValue(intField, 12.6)).toBe(13)
  })

  test('tracks pending change equality with float tolerance', () => {
    expect(hasPendingBoardConfigChange(0.8, 0.8000000001)).toBe(false)
    expect(hasPendingBoardConfigChange(0.8, 0.85)).toBe(true)
    expect(hasPendingBoardConfigChange(true, false)).toBe(true)
    expect(hasPendingBoardConfigChange(1, true)).toBe(false)
  })

  test('builds review entries with old -> new values, risk flags, and reboot notes', () => {
    const schema: BoardConfigSchema = {
      hash: 'test',
      fields: [
        makeField({
          id: 'fault_adc1',
          label: 'ADC1 Threshold',
          unit: 'V',
          editorDecimals: 2,
        }),
        makeField({
          id: 'hardware.leds.mode',
          type: 'uint8',
          label: 'LED Mode',
          enumNames: ['Off', 'Internal', 'External'],
        }),
        makeField({
          id: 'leds.on',
          type: 'bool',
          label: 'LEDs Enabled',
        }),
      ],
      groups: [],
    }

    const entries = buildBoardConfigReviewEntries({
      changes: {
        fault_adc1: 2.25,
        'hardware.leds.mode': 2,
        'leds.on': false,
      },
      currentValues: {
        fault_adc1: 2.0,
        'hardware.leds.mode': 1,
        'leds.on': true,
      },
      schema,
      refloatBaseVersion: '1.3.0',
    })

    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({
      fieldId: 'fault_adc1',
      oldFormatted: '2 V',
      newFormatted: '2.25 V',
      risk: 'risky',
      rebootNote: null,
    })
    expect(entries[1]).toMatchObject({
      fieldId: 'hardware.leds.mode',
      oldFormatted: 'Internal',
      newFormatted: 'External',
      risk: null,
    })
    expect(entries[1]!.rebootNote).toBeTruthy()
    expect(entries[2]).toMatchObject({
      fieldId: 'leds.on',
      oldFormatted: 'On',
      newFormatted: 'Off',
    })
    expect(entries[2]!.rebootNote).toBeTruthy()
  })
})
