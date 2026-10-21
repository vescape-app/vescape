import { describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  loadCatalog,
  loadManifest,
  MANIFESTS,
  packDir,
  validateManifest,
  validatePack,
} from './packs'

const catalog = loadCatalog()

describe('alert packs', () => {
  test.each([...MANIFESTS])('%s manifest and generated pack cover the catalog', (name) => {
    const manifest = loadManifest(name)
    expect(validateManifest(catalog, manifest)).toEqual([])
    expect(validatePack(catalog, packDir(manifest))).toEqual([])
  })

  test('a pack missing a slot, line, or value fails the check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'alert-pack-test-'))
    try {
      cpSync(packDir(loadManifest('voice-hev')), dir, { recursive: true })
      const path = join(dir, 'pack.json')
      const pack = JSON.parse(readFileSync(path, 'utf8'))
      delete pack.lines['link.lost']
      delete pack.values.percent['42']
      pack.lines.battery.start = ['lines/gone.m4a']
      writeFileSync(path, JSON.stringify(pack))
      expect(validatePack(catalog, dir)).toEqual([
        'voice-hev: missing value percent.42',
        'voice-hev: missing line link.lost',
        'voice-hev: missing file lines/gone.m4a',
      ])

      const voice = { ...loadManifest('voice-hev'), lines: {} }
      expect(validateManifest(catalog, voice)).toContain('voice-hev: missing line link.lost')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
