import { expect, test } from 'bun:test'
import type { BoardConfigSchema, BoardConfigValues } from 'vescape-core'

import { boardConfigPrefill } from '@/modules/tune/lib/boardConfigPrefill'

const schema: BoardConfigSchema = {
  hash: 'schema-1',
  fields: [
    {
      id: 'kp',
      type: 'float16_scaled',
      xmlType: 1,
      vTx: 7,
      label: 'Angle P',
      unit: null,
      min: 0,
      max: 40,
      offset: 0,
      scale: 10,
      step: 1,
      editorDecimals: 1,
      editorScale: null,
      editAsPercentage: false,
      enumNames: [],
      defaultValue: 20,
      transmittable: true,
      showDisplay: false,
      cDefine: null,
      description: null,
    },
    {
      id: 'ki',
      type: 'float16_scaled',
      xmlType: 1,
      vTx: 7,
      label: 'Angle I',
      unit: null,
      min: 0,
      max: 0.5,
      offset: 2,
      scale: 100000,
      step: 0.005,
      editorDecimals: 3,
      editorScale: null,
      editAsPercentage: false,
      enumNames: [],
      defaultValue: 0.005,
      transmittable: true,
      showDisplay: false,
      cDefine: null,
      description: null,
    },
    {
      id: 'not_a_tune_field',
      type: 'uint8',
      xmlType: 2,
      vTx: 1,
      label: 'Other',
      unit: null,
      min: 0,
      max: 10,
      offset: 4,
      scale: null,
      step: 1,
      editorDecimals: null,
      editorScale: null,
      editAsPercentage: false,
      enumNames: [],
      defaultValue: 1,
      transmittable: true,
      showDisplay: false,
      cDefine: null,
      description: null,
    },
  ],
  groups: [
    {
      name: 'General',
      subgroups: [
        {
          name: 'Tune',
          items: [
            { kind: 'separator', title: 'PID' },
            { kind: 'field', fieldId: 'kp' },
            { kind: 'field', fieldId: 'ki' },
          ],
        },
        {
          name: 'Startup',
          items: [{ kind: 'field', fieldId: 'not_a_tune_field' }],
        },
      ],
    },
  ],
}

const cached: BoardConfigValues = {
  boardId: 'board-1',
  refloatBaseVersion: '1.3.0',
  capturedAtMs: 1000,
  freshness: 'last-known',
  values: { kp: 12, ki: 0.02, not_a_tune_field: 3 },
  schemaHash: schema.hash,
  schema,
}

test('renders Last Known Board Config Values as XML-derived tune groups', () => {
  const prefill = boardConfigPrefill(cached, 'board-1')

  expect(prefill?.refloatBaseVersion).toBe('1.3.0')
  const fields = prefill?.groups.flatMap((group) => group.fields) ?? []
  expect(fields.map((field) => field.id)).toEqual(['kp', 'ki'])
  expect(fields[0]).toMatchObject({ label: 'Angle P', value: 12, min: 0, max: 40 })
})

test('ignores Last Known values for a different board', () => {
  expect(boardConfigPrefill(cached, 'board-2')).toBeNull()
})

test('has no prefill without Last Known values or a selected board', () => {
  expect(boardConfigPrefill(null, 'board-1')).toBeNull()
  expect(boardConfigPrefill(cached, null)).toBeNull()
  expect(boardConfigPrefill({ ...cached, values: {}, schema: null }, 'board-1')).toBeNull()
})
