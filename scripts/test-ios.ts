import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { diffFingerprints, podsFingerprint, type Fingerprint } from './native-sync.ts'

const ROOT = join(import.meta.dir, '..')
const DEFAULT_DESTINATION = 'platform=iOS Simulator,name=iPhone 17'
const TEST_TIMEOUT_MS = Number(process.env.IOS_TEST_TIMEOUT_MS ?? 120_000)
const destination = process.env.IOS_TEST_DESTINATION ?? DEFAULT_DESTINATION
const resultBundle = `/tmp/vesc-ios-tests-${Date.now()}.xcresult`

const CACHE_FILE = join(ROOT, '.expo', 'test-ios', 'sources.json')
// SwiftPM memoizes evaluated manifests keyed on `Package.swift`'s *contents*. Ours globs `ios/`
// rather than listing files, so adding a test leaves the manifest text identical and the memo keeps
// serving the old source list — the new test silently never runs. Drop the memo whenever the file
// list moves. That is the same "sorted path list" signal Pods go stale on, so the fingerprint is
// shared with `native-sync`.
const MANIFEST_CACHE = join(homedir(), 'Library', 'Caches', 'org.swift.swiftpm', 'manifests')

function readSourceCache(): Fingerprint | null {
  if (!existsSync(CACHE_FILE)) return null
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Fingerprint
  } catch {
    return null
  }
}

function invalidateStaleManifestCache(next: Fingerprint) {
  const previous = readSourceCache()
  if (previous) {
    const diff = diffFingerprints(previous, next)
    if (!diff.added.length && !diff.removed.length && !diff.changed.length) return
  }

  console.log('test:ios: dropping the SwiftPM manifest cache because the iOS source layout changed')
  for (const suffix of ['', '-shm', '-wal']) {
    rmSync(join(MANIFEST_CACHE, `manifest.db${suffix}`), { force: true })
  }
}

function writeSourceCache(fingerprint: Fingerprint) {
  mkdirSync(dirname(CACHE_FILE), { recursive: true })
  writeFileSync(CACHE_FILE, `${JSON.stringify(fingerprint, null, 2)}\n`)
}

const sourceFingerprint = podsFingerprint(ROOT)
invalidateStaleManifestCache(sourceFingerprint)

const args = [
  'test',
  '-scheme',
  'VescapeCore-Package',
  '-destination',
  destination,
  '-resultBundlePath',
  resultBundle,
  '-quiet',
]

const decoder = new TextDecoder()
const proc = Bun.spawn(['xcodebuild', ...args], {
  cwd: 'modules/vescape-core',
  stdout: 'pipe',
  stderr: 'pipe',
})

let output = ''
const timeout = setTimeout(() => {
  proc.kill('SIGTERM')
}, TEST_TIMEOUT_MS)

async function collect(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return
  for await (const chunk of stream) {
    output += decoder.decode(chunk)
  }
}

await Promise.all([collect(proc.stdout), collect(proc.stderr)])
const exitCode = await proc.exited
clearTimeout(timeout)

const lines = output
  .split('\n')
  .map((line) => line.trimEnd())
  .filter(Boolean)

const failures = lines.filter((line) => {
  const lower = line.toLowerCase()
  return (
    lower.includes('error:') ||
    lower.includes('failed') ||
    lower.includes('testing cancelled') ||
    lower.includes('test suite') ||
    lower.includes('test case')
  )
})

if (exitCode === 0) {
  writeSourceCache(sourceFingerprint)
  const summary = [...lines]
    .reverse()
    .find((line) => line.includes('Executed ') && line.includes(' tests'))
  console.log(summary ?? 'iOS tests passed.')
  process.exit(0)
}

console.error(`iOS tests failed. Result bundle: ${resultBundle}`)
console.error('')

const useful = failures.length > 0 ? failures : lines.slice(-80)
console.error(useful.slice(-120).join('\n'))
process.exit(exitCode || 1)
