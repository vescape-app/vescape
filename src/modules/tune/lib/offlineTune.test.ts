import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { OFFLINE_REFLOAT_VERSIONS, offlineTuneFields } from './offlineTune'
import { APP_TUNE_FIELD_BY_ID } from './fields'

test('offline templates match bundled versioned schemas and contain only editable Tune fields', () => {
  const sources = ['settings-1.0.0', 'settings-1.1.x', 'settings-1.2.x', 'settings-1.3.0-beta1']
  for (const [index, version] of OFFLINE_REFLOAT_VERSIONS.entries()) {
    const xml = inflateSync(
      readFileSync(`shared/fixtures/refloat-schema/${sources[index]}.xml.zlib`),
    ).toString()
    const fields = offlineTuneFields(version)
    expect(Object.keys(fields).length).toBeGreaterThan(20)
    for (const [id, value] of Object.entries(fields)) {
      expect(APP_TUNE_FIELD_BY_ID.has(id)).toBe(true)
      const block = xml.match(new RegExp(`<${id}>([\\s\\S]*?)</${id}>`))![1]
      expect(value).toBe(Number(block.match(/<val(?:Double|Int)>(.*?)<\/val(?:Double|Int)>/)![1]))
    }
    fields.kp = 999
    expect(offlineTuneFields(version).kp).not.toBe(999)
  }
  expect(() => offlineTuneFields('9.9')).toThrow()
})
