/**
 * Regenerates the built-in effects and voice packs under `shared/alerts/packs/` from the manifests
 * in this directory. Dev-machine only: needs sox, ffmpeg, and a Python with mlx_audio (Kokoro)
 * as `KOKORO_PYTHON` (default `python3`). See docs/alerts.md.
 *
 *   bun run alerts:packs            all packs
 *   bun run alerts:packs voice-hev  one manifest
 *   bun run alerts:packs --force    re-synthesize every voice clip
 */
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CLIP_EXTENSION,
  type EffectsManifest,
  type EffectsPack,
  loadCatalog,
  loadManifest,
  MANIFESTS,
  MANIFEST_DIR,
  packDir,
  type Segment,
  SOURCES_DIR,
  validateManifest,
  validatePack,
  valueRange,
  valueText,
  type ValueType,
  type VoiceManifest,
  type VoicePack,
} from './packs'

const RATE = '22050'
const FORMAT = 'aac-lc m4a, mono 22050 Hz'
const FORCE = process.argv.includes('--force')

const sourceHash = (source: unknown) =>
  createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 16)

function readPreviousPack<T>(dir: string): T | null {
  const path = join(dir, 'pack.json')
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null
}

function run(command: string, args: string[], input?: string) {
  const result = spawnSync(command, args, {
    input,
    stdio: [input ? 'pipe' : 'ignore', 'inherit', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stderr?.toString() ?? result.error}`,
    )
  }
}

const silence = (out: string, seconds: number) =>
  run('sox', [
    '-D',
    '-R',
    '-n',
    '-r',
    RATE,
    '-b',
    '16',
    '-c',
    '1',
    out,
    'trim',
    '0',
    String(seconds),
  ])

function tone(out: string, segment: Segment) {
  const [fadeIn, fadeOut] = segment.fade ?? [0.005, 0.02]
  const dur = segment.dur ?? 0.1
  run('sox', [
    '-D',
    '-R',
    '-n',
    '-r',
    RATE,
    '-b',
    '16',
    '-c',
    '1',
    out,
    'synth',
    String(dur),
    ...segment.synth!.split(' '),
    ...(segment.fx ?? []),
    'fade',
    't',
    String(fadeIn),
    String(dur),
    String(fadeOut),
    'vol',
    String(segment.vol ?? 0.5),
  ])
}

/** A recorded clip resampled to the pack format. */
const recorded = (out: string, file: string) =>
  run('sox', ['-D', '-R', join(SOURCES_DIR, file), '-r', RATE, '-b', '16', '-c', '1', out])

/** Fixed bitrate and bitexact muxing keep re-encoding byte-identical. */
const encode = (wav: string, out: string) =>
  run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    wav,
    '-c:a',
    'aac',
    '-b:a',
    '40k',
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    out,
  ])

function generateEffects(manifest: EffectsManifest, dir: string, tmp: string) {
  const slots: Record<string, string> = {}
  for (const [slot, segments] of Object.entries(manifest.sounds)) {
    const parts: string[] = []
    const add = (make: (out: string) => void) => {
      const out = join(tmp, `${parts.length}.wav`)
      make(out)
      parts.push(out)
    }
    for (const segment of segments) {
      const beep = manifest.beep
      if (segment.gap) add((out) => silence(out, segment.gap!))
      else if (segment.file) add((out) => recorded(out, segment.file!))
      else if (segment.beep && beep) {
        for (let i = 0; i < segment.beep; i++) {
          if (i) add((out) => silence(out, beep.gap))
          add((out) => tone(out, beep))
        }
      } else add((out) => tone(out, segment))
    }
    const wav = join(tmp, 'slot.wav')
    run('sox', ['-D', '-R', ...parts, wav])
    slots[slot] = `${slot}${CLIP_EXTENSION}`
    encode(wav, join(dir, slots[slot]))
  }
  const pack: EffectsPack = {
    id: manifest.id,
    kind: 'effects',
    voice: manifest.voice,
    format: FORMAT,
    slots,
  }
  return pack
}

function generateVoice(manifest: VoiceManifest, dir: string, tmp: string) {
  const catalog = loadCatalog()
  const clips: { text: string; file: string }[] = []
  const lines: VoicePack['lines'] = {}
  for (const [key, line] of Object.entries(manifest.lines)) {
    const part = (name: 'start' | 'end') =>
      (line[name] ?? []).map((text, i) => {
        // An empty `end` is the "none" variant: no clip, native plays start + value only.
        if (!text) return ''
        const file = `lines/${key}.${name}.${i}${CLIP_EXTENSION}`
        clips.push({ text, file })
        return file
      })
    lines[key] = { start: part('start'), end: part('end') }
  }
  const values: VoicePack['values'] = {}
  const types = new Set(
    Object.values(catalog.voiceKeys).filter((type): type is ValueType => !!type),
  )
  for (const type of types) {
    const set: Record<string, string> = {}
    for (const n of valueRange(catalog, type)) {
      set[n] = `values/${type}/${n}${CLIP_EXTENSION}`
      clips.push({ text: valueText(manifest, type, n), file: set[n] })
    }
    values[type] = set
  }

  mkdirSync(join(dir, 'lines'), { recursive: true })
  for (const type of types) mkdirSync(join(dir, 'values', type), { recursive: true })

  // Kokoro on the GPU is not bit-stable run to run, so a clip is synthesized only when its text,
  // voice, or fx changed; unchanged clips are carried over from the committed pack.
  const sources: Record<string, string> = {}
  const previous = readPreviousPack<VoicePack>(packDir(manifest))
  const synth: { text: string; file: string; raw: string }[] = []
  for (const clip of clips) {
    sources[clip.file] = sourceHash({ text: clip.text, kokoro: manifest.kokoro, fx: manifest.fx })
    const old = join(packDir(manifest), clip.file)
    if (!FORCE && previous?.sources?.[clip.file] === sources[clip.file] && existsSync(old)) {
      copyFileSync(old, join(dir, clip.file))
    } else synth.push({ ...clip, raw: join(tmp, `raw${synth.length}.wav`) })
  }
  console.log(`  ${synth.length} of ${clips.length} clips to synthesize`)
  if (synth.length) {
    run(
      process.env.KOKORO_PYTHON ?? 'python3',
      ['-I', join(MANIFEST_DIR, 'kokoro.py')],
      JSON.stringify({
        ...manifest.kokoro,
        clips: synth.map((clip) => ({ text: clip.text, out: clip.raw })),
      }),
    )
  }

  const fx = manifest.fx.split(' ')
  const wav = join(tmp, 'clip.wav')
  for (const clip of synth) {
    // A stronger end trim clips word tails; voice fx are baked in so native never applies any.
    run('sox', [
      '-D',
      '-R',
      clip.raw,
      '-b',
      '16',
      wav,
      'silence',
      '1',
      '0.01',
      '1%',
      'reverse',
      'silence',
      '1',
      '0.005',
      '0.2%',
      'reverse',
      'pad',
      '0',
      '0.03',
      ...fx,
      'rate',
      RATE,
    ])
    encode(wav, join(dir, clip.file))
  }
  const pack: VoicePack = { id: manifest.id, kind: 'voice', format: FORMAT, lines, values, sources }
  return pack
}

const catalog = loadCatalog()
const args = process.argv.slice(2).filter((arg) => arg !== '--force')
const names = args.length ? args : [...MANIFESTS]
const manifests = names.map(loadManifest)
const invalid = manifests.flatMap((manifest) => validateManifest(catalog, manifest))
if (invalid.length) throw new Error(invalid.join('\n'))

for (const manifest of manifests) {
  const dir = packDir(manifest)
  // Build beside the committed pack and swap only after it validates, so a failed run leaves
  // the previous pack intact.
  const staging = `${dir}.staging`
  const tmp = mkdtempSync(join(tmpdir(), 'alert-pack-'))
  try {
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    console.log(`${manifest.kind}-${manifest.id}…`)
    const pack =
      manifest.kind === 'effects'
        ? generateEffects(manifest, staging, tmp)
        : generateVoice(manifest, staging, tmp)
    writeFileSync(join(staging, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`)
    const errors = validatePack(catalog, staging)
    if (errors.length) throw new Error(errors.join('\n'))
    rmSync(dir, { recursive: true, force: true })
    renameSync(staging, dir)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(staging, { recursive: true, force: true })
  }
}
