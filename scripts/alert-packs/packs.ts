import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export const ROOT = join(import.meta.dir, '..', '..')
export const MANIFEST_DIR = import.meta.dir
export const PACKS_DIR = join(ROOT, 'shared', 'alerts', 'packs')
export const MANIFESTS = [
  'effects-retro',
  'effects-simple',
  'effects-hev',
  'effects-clean',
  'voice-hev',
  'voice-clean',
] as const
/** Recorded clips that `file` segments transcode into a pack: today's Retro and Simple sounds. */
export const SOURCES_DIR = join(MANIFEST_DIR, 'sources')
export const CLIP_EXTENSION = '.m4a'

export type ValueType = 'percent' | 'degrees'

export interface Catalog {
  severities: string[]
  /** Slots every effects pack fills. */
  effectSlots: string[]
  /** Slots a pack may leave out → the required slot that plays instead. */
  optionalEffectSlots: Record<string, string>
  voiceKeys: Record<string, ValueType | null>
  valueRanges: Record<ValueType, { min: number; max: number }>
}

export interface Segment {
  /** A recorded clip under `sources/`, resampled to the pack format. */
  file?: string
  synth?: string
  dur?: number
  vol?: number
  fade?: [number, number]
  fx?: string[]
  gap?: number
  beep?: number
}

export interface EffectsManifest {
  id: string
  kind: 'effects'
  voice: string
  sounds: Record<string, Segment[]>
  /** Tone of a `beep` segment; only packs that use `beep` need it. */
  beep?: Segment & { gap: number }
}

/** `start` + value + `end`; each part lists variants picked at random, `""` in `end` is "none". */
export interface Line {
  start: string[]
  end?: string[]
}

export interface VoiceManifest {
  id: string
  kind: 'voice'
  kokoro: { voice: string; speed: number }
  fx: string
  units: Record<ValueType, [singular: string, plural: string]>
  lines: Record<string, Line>
}

/** Generated `pack.json`: every path is relative to the pack directory. */
export interface EffectsPack {
  id: string
  kind: 'effects'
  voice: string
  format: string
  slots: Record<string, string>
}

export interface VoicePack {
  id: string
  kind: 'voice'
  format: string
  lines: Record<string, { start: string[]; end: string[] }>
  values: Partial<Record<ValueType, Record<string, string>>>
  /** Clip path → hash of its text, Kokoro settings, and fx; unchanged clips are not re-synthesized. */
  sources: Record<string, string>
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

export const loadCatalog = () => readJson<Catalog>(join(MANIFEST_DIR, 'catalog.json'))
export const loadManifest = (name: string) =>
  readJson<EffectsManifest | VoiceManifest>(join(MANIFEST_DIR, `${name}.json`))
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

export function validateManifest(catalog: Catalog, manifest: EffectsManifest | VoiceManifest) {
  const errors: string[] = []
  if (manifest.kind === 'effects') {
    for (const slot of catalog.effectSlots) {
      if (!manifest.sounds[slot]?.length) errors.push(`missing slot ${slot}`)
    }
    for (const [slot, segments] of Object.entries(manifest.sounds)) {
      if (!catalog.effectSlots.includes(slot) && !(slot in catalog.optionalEffectSlots))
        errors.push(`unknown slot ${slot}`)
      for (const segment of segments) {
        if (segment.beep && !manifest.beep) errors.push(`${slot}: beep without a beep tone`)
        if (segment.file && !existsSync(join(SOURCES_DIR, segment.file))) {
          errors.push(`${slot}: missing source ${segment.file}`)
        }
      }
    }
  } else {
    for (const key of Object.keys(catalog.voiceKeys)) {
      if (!manifest.lines[key]?.start.length) errors.push(`missing line ${key}`)
    }
    for (const key of Object.keys(manifest.lines)) {
      if (!baseKey(catalog, key)) errors.push(`unknown line ${key}`)
    }
  }
  return errors.map((error) => `${manifest.kind}-${manifest.id}: ${error}`)
}

/** Checks a generated pack against the catalog; every listed clip must exist on disk. */
export function validatePack(catalog: Catalog, dir: string): string[] {
  const path = join(dir, 'pack.json')
  if (!existsSync(path)) return [`${dir}: missing pack.json`]
  const pack = readJson<EffectsPack | VoicePack>(path)
  const name = `${pack.kind}-${pack.id}`
  const errors: string[] = []
  const files: string[] = []
  if (pack.kind === 'effects') {
    for (const slot of catalog.effectSlots) {
      if (!pack.slots[slot]) errors.push(`missing slot ${slot}`)
    }
    for (const slot of Object.keys(pack.slots)) {
      if (!catalog.effectSlots.includes(slot) && !(slot in catalog.optionalEffectSlots))
        errors.push(`unknown slot ${slot}`)
    }
    files.push(...Object.values(pack.slots))
  } else {
    for (const [key, type] of Object.entries(catalog.voiceKeys)) {
      if (!pack.lines[key]?.start.length) errors.push(`missing line ${key}`)
      if (!type) continue
      const clips = pack.values[type] ?? {}
      for (const n of valueRange(catalog, type)) {
        if (!clips[n]) errors.push(`missing value ${type}.${n}`)
      }
    }
    for (const line of Object.values(pack.lines))
      files.push(...line.start, ...line.end.filter(Boolean))
    for (const clips of Object.values(pack.values)) files.push(...Object.values(clips ?? {}))
  }
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
  const [singular, plural] = manifest.units[type]
  return `${numberWords(n)} ${Math.abs(n) === 1 ? singular : plural}.`
}
