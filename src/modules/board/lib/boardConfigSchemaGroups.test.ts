import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import type {
  BoardConfigSchema,
  BoardConfigSchemaField,
  BoardConfigSchemaGroup,
  BoardConfigSchemaGroupItem,
  BoardConfigValueType,
} from 'vescape-core'

import { resolveBoardConfigEditorKind } from '@/modules/board/lib/boardConfigChangeset'
import {
  deriveBoardConfigTabsFromSchema,
  searchSchemaBoardConfig,
} from '@/modules/board/lib/boardConfigSchemaGroups'

function parseFixtureXmlSchema(filename: string): BoardConfigSchema {
  const path = `${import.meta.dir}/../../../../shared/fixtures/refloat-schema/${filename}`
  const xml = inflateSync(Buffer.from(readFileSync(path))).toString('utf8')

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
      enumNames: [...body.matchAll(/<enumNames>([^<]*)<\/enumNames>/g)].map((e) =>
        e[1]!.replaceAll('&amp;', '&').trim(),
      ),
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

describe('boardConfigSchemaGroups', () => {
  test.each(['settings-1.2.1.xml.zlib', 'settings-1.3.0.xml.zlib'])(
    'derives all General subgroups, ::sep:: sections, XML LED enums, read-only Internal, and MCCONF tab for %s',
    (fixture) => {
      const schema = parseFixtureXmlSchema(fixture)
      const refloatValues = Object.fromEntries(
        schema.fields.map((field) => [
          field.id,
          typeof field.defaultValue === 'boolean' || typeof field.defaultValue === 'number'
            ? field.defaultValue
            : 0,
        ]),
      )
      const motorValues = {
        l_current_max: 120,
        l_temp_fet_start: 70,
        l_temp_motor_start: 80,
      }

      const tabs = deriveBoardConfigTabsFromSchema(schema, refloatValues, motorValues)
      const tabLabels = tabs.map((tab) => tab.label)

      expect(tabs[0]?.id).toBe('quick')
      expect(tabs[0]?.label).toBe('Common')
      if (tabs[0]?.kind === 'schema') {
        expect(tabs[0].sections.map((section) => section.title)).toEqual([
          'Footpad and dismount',
          'Startup',
        ])
      }

      for (const expected of [
        'Common',
        'Startup',
        'Stop',
        'Pushback Alerts',
        'Haptic Feedback',
        'Remote',
        'LEDs',
        'Specs',
        'BMS',
        'Tune',
        'Tune Modifiers',
        'ATR',
        'Internal',
        'Motor',
      ]) {
        expect(tabLabels).toContain(expected)
      }

      const startupTab = tabs.find((tab) => tab.label === 'Startup')!
      expect(startupTab.kind).toBe('schema')
      if (startupTab.kind === 'schema') {
        expect(startupTab.sections.map((section) => section.title)).toEqual([
          'Tolerances',
          'Centering',
          'Start Options',
          'Holding',
        ])
      }

      const ledsTab = tabs.find((tab) => tab.label === 'LEDs')!
      expect(ledsTab.kind).toBe('schema')
      if (ledsTab.kind === 'schema') {
        const frontMode = ledsTab.sections
          .flatMap((section) => section.fields)
          .find((field) => field.id === 'leds.front.mode')!
        expect(resolveBoardConfigEditorKind(frontMode)).toBe('enum')
        expect(frontMode.enumNames).toContain('Solid')
        expect(frontMode.enumNames).toContain('Knight Rider')

        const frontColor = ledsTab.sections
          .flatMap((section) => section.fields)
          .find((field) => field.id === 'leds.front.color1')!
        expect(resolveBoardConfigEditorKind(frontColor)).toBe('enum')
        expect(frontColor.enumNames.length).toBeGreaterThanOrEqual(30)

        const brightness = ledsTab.sections
          .flatMap((section) => section.fields)
          .find((field) => field.id === 'leds.front.brightness')!
        expect(resolveBoardConfigEditorKind(brightness)).toBe('percentage')
      }

      const pushbackTab = tabs.find((tab) => tab.label === 'Pushback Alerts')!
      if (pushbackTab.kind === 'schema') {
        const duty = pushbackTab.sections
          .flatMap((section) => section.fields)
          .find((field) => field.id === 'tiltback_duty')!
        expect(resolveBoardConfigEditorKind(duty)).toBe('percentage')
      }

      const specsTab = tabs.find((tab) => tab.label === 'Specs')!
      if (specsTab.kind === 'schema') {
        const specsFields = specsTab.sections.flatMap((section) => section.fields)
        expect(specsFields.length).toBeGreaterThan(15)
        for (const field of specsFields) {
          expect(field.risk).toBe(field.id.startsWith('hardware.leds.') ? null : 'risky')
          expect(field.editable).toBe(true)
        }
      }

      const internalTab = tabs.find((tab) => tab.label === 'Internal')!
      expect(internalTab.kind).toBe('schema')
      if (internalTab.kind === 'schema') {
        expect(internalTab.readOnly).toBe(true)
        const internalFields = internalTab.sections.flatMap((section) => section.fields)
        expect(internalFields.some((field) => field.id === 'meta.is_default')).toBe(true)
        for (const field of internalFields) {
          expect(field.editable).toBe(false)
          expect(resolveBoardConfigEditorKind(field)).toBe('readonly')
        }
      }

      const motorTab = tabs.find((tab) => tab.id === 'motor')!
      expect(motorTab.kind).toBe('motor')
      if (motorTab.kind === 'motor') {
        const motorIds = motorTab.groups.flatMap((group) => group.rows.map((row) => row.id))
        expect(motorIds).toContain('l_current_max')
        expect(motorIds).toContain('l_temp_fet_start')
      }

      const editableGeneralFields = tabs
        .filter((tab) => tab.kind === 'schema' && !tab.readOnly)
        .flatMap((tab) =>
          tab.kind === 'schema' ? tab.sections.flatMap((section) => section.fields) : [],
        )
      for (const field of editableGeneralFields) {
        expect(field.editable).toBe(true)
        expect(resolveBoardConfigEditorKind(field)).not.toBe('readonly')
      }
    },
  )

  test('searches across both schema Refloat fields and read-only MCCONF rows', () => {
    const schema = parseFixtureXmlSchema('settings-1.3.0.xml.zlib')
    const refloatValues = Object.fromEntries(
      schema.fields.map((field) => [
        field.id,
        typeof field.defaultValue === 'boolean' || typeof field.defaultValue === 'number'
          ? field.defaultValue
          : 0,
      ]),
    )
    const motorValues = { l_temp_fet_start: 70, l_current_max: 120 }
    const tabs = deriveBoardConfigTabsFromSchema(schema, refloatValues, motorValues)

    const posiHits = searchSchemaBoardConfig(tabs, 'posi', ['refloat', 'motor'])
    expect(posiHits[0]?.kind).toBe('schema')
    expect(posiHits[0]?.fields?.map((field) => field.id)).toContain('fault_is_dual_switch')

    const fetHits = searchSchemaBoardConfig(tabs, 'fet', ['refloat', 'motor'])
    expect(fetHits[0]?.kind).toBe('motor')
    expect(fetHits[0]?.rows?.map((row) => row.id)).toContain('l_temp_fet_start')
  })
})
