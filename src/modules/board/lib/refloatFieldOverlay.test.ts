import { describe, expect, test } from 'bun:test'
import { inflateSync } from 'node:zlib'
import type {
  BoardConfigSchema,
  BoardConfigSchemaField,
  BoardConfigSchemaGroup,
  BoardConfigSchemaGroupItem,
  BoardConfigValueType,
} from 'vescape-core'

import {
  deriveTuneGroupsFromSchema,
  effectiveHardRange,
  REFLOAT_FIELD_OVERLAY,
  resolveBoardConfigField,
  tuneFieldIdsFromSchema,
} from '@/modules/board/lib/refloatFieldOverlay'

function parseFixtureXmlSchema(filename: string): BoardConfigSchema {
  const path = `${import.meta.dir}/../../../../shared/fixtures/refloat-schema/${filename}`
  const xml = inflateSync(Buffer.from(require('node:fs').readFileSync(path))).toString('utf8')

  const paramsBlock = xml.slice(xml.indexOf('<Params>'), xml.indexOf('</Params>'))
  const params = new Map<string, string>()
  for (const m of paramsBlock.matchAll(/^ {8}<([A-Za-z0-9_.]+)>([\s\S]*?)^ {8}<\/\1>/gm)) {
    params.set(m[1]!, m[2]!)
  }

  const serOrderBlock = xml.slice(xml.indexOf('<SerOrder>'), xml.indexOf('</SerOrder>'))
  const order = [...serOrderBlock.matchAll(/<ser>([^<]+)<\/ser>/g)].map((m) => m[1]!.trim())

  const tag = (body: string, name: string) =>
    body.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1]?.trim() ?? null

  const fields: BoardConfigSchemaField[] = []
  let offset = 0
  for (const id of order) {
    const body = params.get(id)!
    const xmlType = Number(tag(body, 'type'))
    const vTx = Number(tag(body, 'vTx') ?? '0')
    let type: BoardConfigValueType = 'uint8'
    let byteSize = 1
    if (xmlType === 1) {
      if (vTx === 7) {
        type = 'float16_scaled'
        byteSize = 2
      } else if (vTx === 8) {
        type = 'float32_scaled'
        byteSize = 4
      } else {
        type = 'float32_auto'
        byteSize = 4
      }
    } else if (xmlType === 2) {
      if (vTx === 1) {
        type = 'uint8'
        byteSize = 1
      } else if (vTx === 2) {
        type = 'int8'
        byteSize = 1
      } else if (vTx === 3) {
        type = 'uint16'
        byteSize = 2
      } else if (vTx === 4) {
        type = 'int16'
        byteSize = 2
      } else if (vTx === 5) {
        type = 'uint32'
        byteSize = 4
      } else {
        type = 'int32'
        byteSize = 4
      }
    } else if (xmlType === 5) {
      type = 'bool'
      byteSize = 1
    }
    const num = (v: string | null) =>
      v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null
    fields.push({
      id,
      type,
      xmlType,
      vTx,
      label: tag(body, 'longName') ?? id,
      unit: tag(body, 'suffix') || null,
      min: num(tag(body, 'minDouble')) ?? num(tag(body, 'minInt')),
      max: num(tag(body, 'maxDouble')) ?? num(tag(body, 'maxInt')),
      offset,
      scale: num(tag(body, 'vTxDoubleScale')),
      step: num(tag(body, 'stepDouble')) ?? num(tag(body, 'stepInt')),
      editorDecimals: num(tag(body, 'editorDecimalsDouble')),
      editorScale: num(tag(body, 'editorScale')),
      editAsPercentage: tag(body, 'editAsPercentage') === '1',
      enumNames: [...body.matchAll(/<enumNames>([^<]*)<\/enumNames>/g)].map((e) => e[1]!.trim()),
      defaultValue:
        type === 'bool'
          ? tag(body, 'valInt') === '1'
          : (num(tag(body, 'valDouble')) ?? num(tag(body, 'valInt'))),
      transmittable: tag(body, 'transmittable') !== '0',
      showDisplay: tag(body, 'showDisplay') === '1',
      cDefine: tag(body, 'cDefine'),
      description: null,
    })
    offset += byteSize
  }

  const groupingBlock = xml.slice(xml.indexOf('<Grouping>'), xml.indexOf('</Grouping>'))
  const groups: BoardConfigSchemaGroup[] = []
  for (const gm of groupingBlock.matchAll(/<group>([\s\S]*?)<\/group>/g)) {
    const groupName = tag(gm[1]!, 'groupName') ?? ''
    const subgroups = []
    for (const sm of gm[1]!.matchAll(/<subgroup>([\s\S]*?)<\/subgroup>/g)) {
      const subgroupName = tag(sm[1]!, 'subgroupName') ?? ''
      const items: BoardConfigSchemaGroupItem[] = []
      for (const pm of sm[1]!.matchAll(/<param>([^<]+)<\/param>/g)) {
        const token = pm[1]!.trim()
        if (token.startsWith('::sep::')) {
          items.push({ kind: 'separator', title: token.slice('::sep::'.length).trim() })
        } else {
          items.push({ kind: 'field', fieldId: token })
        }
      }
      subgroups.push({ name: subgroupName, items })
    }
    groups.push({ name: groupName, subgroups })
  }

  return { hash: filename, fields, groups }
}

describe('refloatFieldOverlay', () => {
  test('derives all 54 tune fields on Refloat 1.3.0 including new filter fields', () => {
    const schema = parseFixtureXmlSchema('settings-1.3.0.xml.zlib')
    const values = Object.fromEntries(schema.fields.map((f) => [f.id, f.defaultValue ?? 0]))

    const groups = deriveTuneGroupsFromSchema(schema, values)
    const ids = groups.flatMap((g) => g.fields.map((f) => f.id))

    expect(ids).toHaveLength(54)
    expect(ids).toContain('torque_tilt.filter.time_constant')
    expect(ids).toContain('turn_tilt.filter.time_constant')
    expect(ids).toContain('atr.filter.time_constant')
    expect(ids).toContain('atr.transition_boost')
    expect(ids).not.toContain('atr_on_speed')
    expect(ids).not.toContain('torquetilt_on_speed')
    expect(ids).not.toContain('turntilt_speed')
    expect(ids).not.toContain('meta.is_default')
  })

  test('derives only 1.2.1 tune fields on Refloat 1.2.1 and ignores 1.3-only overlay entries', () => {
    const schema = parseFixtureXmlSchema('settings-1.2.1.xml.zlib')
    const values = Object.fromEntries(schema.fields.map((f) => [f.id, f.defaultValue ?? 0]))

    const groups = deriveTuneGroupsFromSchema(schema, values)
    const ids = groups.flatMap((g) => g.fields.map((f) => f.id))

    expect(ids).toHaveLength(49)
    expect(ids).toContain('atr_on_speed')
    expect(ids).toContain('torquetilt_on_speed')
    expect(ids).toContain('turntilt_speed')
    expect(ids).not.toContain('atr.transition_boost')
    expect(ids).not.toContain('torque_tilt.filter.time_constant')
    expect(ids).not.toContain('turn_tilt.filter.time_constant')
    expect(ids).not.toContain('atr.filter.time_constant')
    expect(tuneFieldIdsFromSchema(schema).size).toBe(49)
  })

  test('field without overlay renders from XML label, unit, range, step, and enum names', () => {
    const xmlOnlyField: BoardConfigSchemaField = {
      id: 'custom.experimental_mode',
      type: 'uint8',
      xmlType: 4,
      vTx: 1,
      label: 'Experimental Mode',
      unit: 'mode',
      min: 0,
      max: 2,
      offset: 0,
      scale: null,
      step: 1,
      editorDecimals: 0,
      editorScale: null,
      editAsPercentage: false,
      enumNames: ['Off', 'Mild', 'Wild'],
      defaultValue: 1,
      transmittable: true,
      showDisplay: false,
      cDefine: null,
      description: 'XML description text',
    }
    const resolved = resolveBoardConfigField(xmlOnlyField, 1)
    expect(resolved).toMatchObject({
      id: 'custom.experimental_mode',
      label: 'Experimental Mode',
      unit: 'mode',
      min: 0,
      max: 2,
      hardMin: 0,
      hardMax: 2,
      step: 1,
      enumNames: ['Off', 'Mild', 'Wild'],
      description: 'XML description text',
      editable: true,
    })
  })

  test('soft overlay range narrows slider while hard bound stays at schema ∩ wire ∩ hardLimit', () => {
    const atrField: BoardConfigSchemaField = {
      id: 'atr_strength_up',
      type: 'float16_scaled',
      xmlType: 1,
      vTx: 7,
      label: 'ATR Uphill Strength',
      unit: null,
      min: 0,
      max: 3.5,
      offset: 0,
      scale: 1000,
      step: 0.1,
      editorDecimals: 1,
      editorScale: null,
      editAsPercentage: false,
      enumNames: [],
      defaultValue: 1.0,
      transmittable: true,
      showDisplay: false,
      cDefine: null,
      description: null,
    }
    const resolved = resolveBoardConfigField(atrField, 2.5)
    expect(resolved.min).toBe(0)
    expect(resolved.max).toBe(2)
    expect(resolved.hardMin).toBe(0)
    expect(resolved.hardMax).toBe(3.5)

    const tightened = effectiveHardRange(atrField, { hardLimit: { min: 0.5, max: 3.0 } })
    expect(tightened).toEqual({ min: 0.5, max: 3.0 })
  })

  test('meta.is_default is marked hidden and internal in bundled overlay', () => {
    expect(REFLOAT_FIELD_OVERLAY['meta.is_default']).toEqual({
      hidden: true,
      risk: 'internal',
    })
  })
})
