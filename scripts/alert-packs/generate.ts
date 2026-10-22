/**
 * Regenerates the built-in voice packs under `shared/alerts/packs/` from the manifests
 * in this directory (effects packs are made in a DAW, see EFFECTS.md). Dev-machine only: needs sox, ffmpeg, and a Python with mlx_audio (Kokoro)
 * as `KOKORO_PYTHON` (default `python3`). See docs/alerts.md.
 *
 *   bun run alerts:packs            all packs
 *   bun run alerts:packs voice-radio  one manifest
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
  loadCatalog,
  loadManifest,
  MANIFESTS,
  MANIFEST_DIR,
  packDir,
  validateManifest,
  validatePack,
  valueClips,
  valueText,
  valueTypes,
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

function generateVoice(manifest: VoiceManifest, dir: string, tmp: string) {
  const catalog = loadCatalog()
  const clips: { text: string; file: string }[] = []
  const lines: VoicePack['lines'] = {}
  for (const [key, line] of Object.entries(manifest.lines)) {
    const part = (name: string, texts: string[] | undefined) => {
      if (!texts?.length) return undefined
      return texts.map((text, i) => {
        const file = `lines/${key}.${name}.${i}${CLIP_EXTENSION}`
        clips.push({ text, file })
        return file
      })
    }
    const full = line.full && {
      start: part('full.start', line.full.start),
      end: part('full.end', line.full.end),
      endChance: line.full.endChance,
    }
    lines[key] = {
      start: part('start', line.start) ?? [],
      minimal: part('minimal', line.minimal),
      full,
    }
  }
  const values: VoicePack['values'] = {}
  const types = valueTypes(catalog)
  for (const type of types) {
    const set: Record<string, string> = {}
    for (const n of valueClips(catalog, type)) {
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
    const pack = generateVoice(manifest, staging, tmp)
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
