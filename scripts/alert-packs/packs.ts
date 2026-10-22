import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export const ROOT = join(import.meta.dir, '..', '..')
export const MANIFEST_DIR = import.meta.dir
export const PACKS_DIR = join(ROOT, 'shared', 'alerts', 'packs')
export const MANIFESTS = ['voice-nova', 'voice-radio', 'voice-nicole'] as const
export const CLIP_EXTENSION = '.m4a'

/** `number` is a bare number: speed and duty skip the unit so the line stays short. */
export type ValueType = 'percent' | 'degrees' | 'number'

export interface Catalog {
  severities: string[]
  voiceKeys: Record<string, ValueType | null>
  valueRanges: Record<ValueType, { min: number; max: number }>
}

/**
 * A line, by voice level: Minimal speaks `minimal` (else `start`) on the generic key only; Standard
 * speaks `start`; Full speaks `full.start` (else `start`) and then one of `full.end` at
 * `full.endChance` (default 1). Each list holds variants picked at random.
 */
export interface Line {
  start: string[]
  minimal?: string[]
  full?: { start?: string[]; end?: string[]; endChance?: number }
}

export interface VoiceManifest {
  id: string
  kind: 'voice'
  kokoro: { voice: string; speed: number }
  fx: string
  units: Record<Exclude<ValueType, 'number'>, [singular: string, plural: string]>
  lines: Record<string, Line>
}

/** Generated `pack.json`: every path is relative to the pack directory. */
export interface VoicePack {
  id: string
  kind: 'voice'
  format: string
  lines: Record<string, Line>
  values: Partial<Record<ValueType, Record<string, string>>>
  /** Clip path → hash of its text, Kokoro settings, and fx; unchanged clips are not re-synthesized. */
  sources: Record<string, string>
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

export const loadCatalog = () => readJson<Catalog>(join(MANIFEST_DIR, 'catalog.json'))
export const loadManifest = (name: string) =>
  readJson<VoiceManifest>(join(MANIFEST_DIR, `${name}.json`))
export const packDir = (manifest: { kind: string; id: string }) =>
  join(PACKS_DIR, `${manifest.kind}-${manifest.id}`)

export function valueRange(catalog: Catalog, type: ValueType): number[] {
  const { min, max } = catalog.valueRanges[type]
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
}

/** Key a line variant falls back to: `battery.critical` → `battery`. */
export function baseKey(catalog: Catalog, key: string): string | null {
  if (key in catalog.voiceKeys) return key
  const dot = key.lastIndexOf('.')
  if (dot < 0) return null
  const base = key.slice(0, dot)
  return base in catalog.voiceKeys && catalog.severities.includes(key.slice(dot + 1)) ? base : null
}

/** Every phrase of a line: clip paths in a pack, texts in a manifest. */
export const lineTexts = (line: Line) => [
  ...line.start,
  ...(line.minimal ?? []),
  ...(line.full?.start ?? []),
  ...(line.full?.end ?? []),
]

export function validateManifest(catalog: Catalog, manifest: VoiceManifest) {
  const errors: string[] = []
  for (const key of Object.keys(catalog.voiceKeys)) {
    if (!manifest.lines[key]?.start.length) errors.push(`missing line ${key}`)
  }
  for (const [key, line] of Object.entries(manifest.lines)) {
    if (!baseKey(catalog, key)) errors.push(`unknown line ${key}`)
    if (line.minimal && key !== baseKey(catalog, key))
      errors.push(`minimal on severity line ${key}`)
    if (lineTexts(line).some((text) => !text.trim())) errors.push(`empty phrase in ${key}`)
    const chance = line.full?.endChance
    if (chance != null && !(chance > 0 && chance <= 1))
      errors.push(`endChance out of (0, 1] in ${key}`)
  }
  return errors.map((error) => `${manifest.kind}-${manifest.id}: ${error}`)
}

/** Checks a generated voice pack against the catalog; every listed clip must exist on disk. */
export function validatePack(catalog: Catalog, dir: string): string[] {
  const path = join(dir, 'pack.json')
  if (!existsSync(path)) return [`${dir}: missing pack.json`]
  const pack = readJson<VoicePack>(path)
  const name = `${pack.kind}-${pack.id}`
  const errors: string[] = []
  const files: string[] = []
  for (const [key, type] of Object.entries(catalog.voiceKeys)) {
    if (!pack.lines[key]?.start.length) errors.push(`missing line ${key}`)
    if (!type) continue
    const clips = pack.values[type] ?? {}
    for (const n of valueRange(catalog, type)) {
      if (!clips[n]) errors.push(`missing value ${type}.${n}`)
    }
  }
  for (const line of Object.values(pack.lines)) files.push(...lineTexts(line))
  for (const clips of Object.values(pack.values)) files.push(...Object.values(clips ?? {}))
  for (const file of files) {
    if (!existsSync(join(dir, file))) errors.push(`missing file ${file}`)
  }
  return errors.map((error) => `${name}: ${error}`)
}

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** English words for an integer in −999…999, spelled out so Kokoro never guesses. */
export function numberWords(n: number): string {
  if (n < 0) return `minus ${numberWords(-n)}`
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')
  const rest = n % 100
  return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` ${numberWords(rest)}` : ''}`
}

export function valueText(manifest: VoiceManifest, type: ValueType, n: number) {
  if (type === 'number') return `${numberWords(n)}.`
  const [singular, plural] = manifest.units[type]
  return `${numberWords(n)} ${Math.abs(n) === 1 ? singular : plural}.`
}
