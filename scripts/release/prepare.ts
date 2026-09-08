import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildReleaseNotes,
  GENERATED_RELEASE_NOTES_PATH,
  validateReleaseMarkdown,
} from '../release-notes/bundler'
import { resolveEditorCommand } from '../release-notes/editor'
import { selectPrompt } from '../release-notes/prompt'
import { resolveReleaseNotePlan } from '../release-notes/plan'
import { releaseNotesPrompt } from '../release-notes/draftPrompt'
import { reviewReleaseNoteDraft } from '../release-notes/review'
import { clearReleaseDraft, loadReleaseDraft, saveReleaseDraft } from './draftCache'

const ROOT = join(import.meta.dir, '../..')
const PACKAGE_PATH = join(ROOT, 'package.json')

export type VersionBump = 'major' | 'minor' | 'patch'

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function command(program: string, args: string[], inherit = false): Promise<CommandResult> {
  const child = Bun.spawn([program, ...args], {
    cwd: ROOT,
    stdin: inherit ? 'inherit' : 'ignore',
    stdout: inherit ? 'inherit' : 'pipe',
    stderr: inherit ? 'inherit' : 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    inherit ? Promise.resolve('') : new Response(child.stdout).text(),
    inherit ? Promise.resolve('') : new Response(child.stderr).text(),
  ])
  return { exitCode, stdout: stdout.trimEnd(), stderr: stderr.trim() }
}

async function checked(program: string, args: string[], label: string): Promise<string> {
  const result = await command(program, args)
  if (result.exitCode !== 0) throw new Error(`${label}: ${result.stderr || result.stdout}`)
  return result.stdout
}

export function bumpMarketingVersion(version: string, bump: VersionBump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`Cannot bump non-stable marketing version "${version}"`)
  const [, majorSource, minorSource, patchSource] = match
  const major = Number(majorSource)
  const minor = Number(minorSource)
  const patch = Number(patchSource)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

export function parsePorcelainPaths(status: string): string[] {
  return status
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^.* -> /, ''))
}

interface ReleasePreparationStatus {
  baseVersion: string
  workingVersion: string
  changedPaths: readonly string[]
  noteExists: boolean
}

export function assertReleasePreparationStatus({
  baseVersion,
  workingVersion,
  changedPaths,
  noteExists,
}: ReleasePreparationStatus): void {
  if (changedPaths.length === 0) return
  const validNextVersions = new Set<VersionBump>(['major', 'minor', 'patch'])
  const isNextVersion = [...validNextVersions].some(
    (bump) => bumpMarketingVersion(baseVersion, bump) === workingVersion,
  )
  const notesPath = releaseNotesPath(workingVersion)
  const expected = new Set(['package.json', notesPath, GENERATED_RELEASE_NOTES_PATH])
  const isExactDraft =
    isNextVersion &&
    changedPaths.includes('package.json') &&
    changedPaths.every((path) => expected.has(path)) &&
    (!changedPaths.includes(notesPath) || noteExists)
  if (!isExactDraft) {
    throw new Error('Commit or stash current changes before preparing a release version')
  }
}

export function releaseNotesPath(version: string): string {
  return `release-notes/${version}.md`
}

type ReleaseNotesChoice = 'draft' | 'skip'

interface ReleaseNotesDependencies {
  exists(path: string): Promise<boolean>
  read(path: string): Promise<string>
  select(): Promise<ReleaseNotesChoice>
  author(version: string): Promise<void>
  validate(source: string, label: string): void
  build(): Promise<void>
  log(message: string): void
}

/**
 * Notes are written once per marketing version and never rewritten: a shipped version keeps the
 * copy its riders read.
 */
export async function prepareReleaseNotes(
  marketingVersion: string,
  dependencies: ReleaseNotesDependencies = releaseNotesDependencies(),
): Promise<string> {
  const notesPath = releaseNotesPath(marketingVersion)
  const notes = join(ROOT, notesPath)

  if (await dependencies.exists(notes)) {
    dependencies.validate(await dependencies.read(notes), notesPath)
    await dependencies.build()
    dependencies.log(`\n✓ Using existing ${notesPath}`)
    return notesPath
  }

  dependencies.log(`\nNo canonical notes exist for ${marketingVersion}.`)
  if ((await dependencies.select()) === 'draft') await dependencies.author(marketingVersion)
  if (await dependencies.exists(notes)) {
    dependencies.validate(await dependencies.read(notes), notesPath)
    await dependencies.build()
  } else {
    dependencies.log(`✓ Skipping ${notesPath}; production promotion will require it`)
  }
  return notesPath
}

function releaseNotesDependencies(): ReleaseNotesDependencies {
  return {
    exists: async (path) => Bun.file(path).exists(),
    read: (path) => readFile(path, 'utf8'),
    select: async () =>
      selectPrompt('Prepare release notes', [
        { value: 'draft', label: 'Draft with Codex' },
        { value: 'skip', label: 'Skip for now' },
      ] as const),
    author: async (version) => {
      const author = await command(
        'bun',
        ['run', 'release-notes:author', `--version=${version}`],
        true,
      )
      if (author.exitCode !== 0) {
        throw new Error(`Release-note authoring exited with code ${author.exitCode}`)
      }
    },
    validate: validateReleaseMarkdown,
    build: buildReleaseNotes,
    log: console.log,
  }
}

export async function currentMarketingVersion(): Promise<string> {
  const pkg = JSON.parse(
    await checked('git', ['show', 'HEAD:package.json'], 'Cannot read current marketing version'),
  ) as { version?: unknown }
  if (typeof pkg.version !== 'string') throw new Error('package.json has no marketing version')
  bumpMarketingVersion(pkg.version, 'patch')
  return pkg.version
}

export async function currentPreparedReleaseVersion(): Promise<string | null> {
  const [version, subject, head, remoteDev, remoteMain] = await Promise.all([
    currentMarketingVersion(),
    checked('git', ['log', '-1', '--format=%s'], 'Cannot read latest commit'),
    checked('git', ['rev-parse', 'HEAD^{commit}'], 'Cannot read HEAD'),
    command('git', ['rev-parse', 'origin/dev^{commit}']),
    command('git', ['rev-parse', 'origin/main^{commit}']),
  ])
  if (
    subject !== `release: ${version}` ||
    remoteDev.exitCode !== 0 ||
    remoteMain.exitCode !== 0 ||
    remoteDev.stdout !== head ||
    remoteMain.stdout !== head
  )
    return null
  const notes = await command('git', ['cat-file', '-e', `HEAD:${releaseNotesPath(version)}`])
  return notes.exitCode === 0 ? version : null
}

export async function currentReleaseDraft(): Promise<{
  version: string
  bump: VersionBump
} | null> {
  const [baseVersion, sourceSha] = await Promise.all([
    currentMarketingVersion(),
    checked('git', ['rev-parse', 'HEAD^{commit}'], 'Cannot read HEAD'),
  ])
  const draft = await loadReleaseDraft(sourceSha, baseVersion)
  return draft ? { version: bumpMarketingVersion(baseVersion, draft.bump), bump: draft.bump } : null
}

export async function verifyReleasePreparationReady(): Promise<void> {
  resolveEditorCommand()
  const branch = await checked('git', ['branch', '--show-current'], 'Cannot read current branch')
  if (branch !== 'dev')
    throw new Error(`Release preparation must run from dev, currently ${branch}`)
  const status = await checked('git', ['status', '--porcelain'], 'Cannot inspect working tree')
  const changedPaths = parsePorcelainPaths(status)
  const baseVersion = await currentMarketingVersion()
  const pkg = JSON.parse(await readFile(PACKAGE_PATH, 'utf8')) as { version?: unknown }
  if (typeof pkg.version !== 'string') throw new Error('package.json has no marketing version')
  assertReleasePreparationStatus({
    baseVersion,
    workingVersion: pkg.version,
    changedPaths,
    noteExists: await Bun.file(join(ROOT, releaseNotesPath(pkg.version))).exists(),
  })
}

export async function prepareReleaseCandidate(
  bump: VersionBump,
): Promise<
  | { kind: 'prepared'; marketingVersion: string; sourceSha: string }
  | { kind: 'discarded' }
  | { kind: 'paused' }
> {
  await verifyReleasePreparationReady()
  const initialStatus = await checked(
    'git',
    ['status', '--porcelain'],
    'Cannot inspect working tree',
  )
  const resumingDraft = parsePorcelainPaths(initialStatus).length > 0
  const originalPackage = await readFile(PACKAGE_PATH, 'utf8')
  const baseVersion = await currentMarketingVersion()
  const pkg = JSON.parse(originalPackage) as { version?: unknown }
  if (typeof pkg.version !== 'string') throw new Error('package.json has no marketing version')
  let selectedBump = bump
  let marketingVersion = bumpMarketingVersion(baseVersion, selectedBump)
  if (resumingDraft) {
    if (pkg.version !== marketingVersion) {
      throw new Error(
        `Existing release draft is v${pkg.version}; choose the matching version bump to resume it`,
      )
    }
  }

  if (!resumingDraft) {
    const pinnedSourceSha = await checked(
      'git',
      ['rev-parse', 'HEAD^{commit}'],
      'Cannot pin release source',
    )
    const cached = await loadReleaseDraft(pinnedSourceSha, baseVersion)
    if (cached) selectedBump = cached.bump
    let savedDraft: { markdown: string; threadId: string } | undefined = cached ?? undefined
    while (true) {
      marketingVersion = bumpMarketingVersion(baseVersion, selectedBump)
      const notePlan = await resolveReleaseNotePlan(pinnedSourceSha, marketingVersion)
      const review = await reviewReleaseNoteDraft({
        root: ROOT,
        destination: join(ROOT, releaseNotesPath(marketingVersion)),
        label: `${marketingVersion}.md`,
        editorCommand: resolveEditorCommand(),
        initialPrompt: releaseNotesPrompt(notePlan),
        initialDraft: savedDraft,
        persist: false,
        allowVersionChange: true,
        acceptLabel: `Accept and release ${marketingVersion}`,
        onDraft: (draft) =>
          saveReleaseDraft({
            sourceSha: pinnedSourceSha,
            baseVersion,
            bump: selectedBump,
            ...draft,
          }),
      })
      if (review.kind === 'discarded') {
        await clearReleaseDraft()
        return { kind: 'discarded' }
      }
      if (review.kind === 'paused') return { kind: 'paused' }
      if (review.kind === 'change-version') {
        savedDraft = review
        try {
          selectedBump = await selectPrompt('Choose a different version', [
            { value: 'patch', label: `Patch  ${bumpMarketingVersion(baseVersion, 'patch')}` },
            { value: 'minor', label: `Minor  ${bumpMarketingVersion(baseVersion, 'minor')}` },
            { value: 'major', label: `Major  ${bumpMarketingVersion(baseVersion, 'major')}` },
          ] as const)
        } catch (error) {
          if (!(error instanceof Error && error.message === 'Selection cancelled')) throw error
        }
        continue
      }

      const currentSourceSha = await checked(
        'git',
        ['rev-parse', 'HEAD^{commit}'],
        'Cannot revalidate release source',
      )
      if (currentSourceSha !== pinnedSourceSha) {
        throw new Error('Source changed while reviewing release notes; generate a fresh draft')
      }
      const acceptanceStatus = await checked(
        'git',
        ['status', '--porcelain'],
        'Cannot revalidate working tree',
      )
      if (acceptanceStatus) {
        throw new Error(
          'Working tree changed while reviewing release notes; no release files were written',
        )
      }
      await checked('git', ['fetch', 'origin', 'dev', 'main'], 'Cannot refresh release branches')
      const remoteDev = await checked(
        'git',
        ['rev-parse', 'origin/dev^{commit}'],
        'Cannot read origin/dev',
      )
      const remoteMain = await checked(
        'git',
        ['rev-parse', 'origin/main^{commit}'],
        'Cannot read origin/main',
      )
      const remoteDevAncestor = await command('git', [
        'merge-base',
        '--is-ancestor',
        remoteDev,
        pinnedSourceSha,
      ])
      const remoteMainAncestor = await command('git', [
        'merge-base',
        '--is-ancestor',
        remoteMain,
        pinnedSourceSha,
      ])
      if (remoteDevAncestor.exitCode !== 0 || remoteMainAncestor.exitCode !== 0) {
        throw new Error(
          'A release branch changed incompatibly while reviewing notes; generate a fresh draft',
        )
      }
      pkg.version = marketingVersion
      await writeFile(PACKAGE_PATH, `${JSON.stringify(pkg, null, 2)}\n`)
      await writeFile(join(ROOT, releaseNotesPath(marketingVersion)), review.markdown, {
        flag: 'wx',
      })
      await buildReleaseNotes()
      break
    }
  } else {
    await prepareReleaseNotes(marketingVersion)
  }

  const notesPath = releaseNotesPath(marketingVersion)

  const status = await checked('git', ['status', '--porcelain'], 'Cannot inspect release changes')
  const changedPaths = parsePorcelainPaths(status)
  const expected = new Set(['package.json', notesPath, GENERATED_RELEASE_NOTES_PATH])
  const unexpected = changedPaths.filter((path) => !expected.has(path))
  if (unexpected.length > 0) {
    throw new Error(`Unexpected release changes: ${unexpected.join(', ')}`)
  }
  if (!changedPaths.includes('package.json')) {
    throw new Error('Release preparation did not produce a version change')
  }

  const pathsToStage = ['package.json']
  if (changedPaths.includes(notesPath)) pathsToStage.push(notesPath)
  if (changedPaths.includes(GENERATED_RELEASE_NOTES_PATH)) {
    pathsToStage.push(GENERATED_RELEASE_NOTES_PATH)
  }
  await checked('git', ['add', ...pathsToStage], 'Cannot stage release candidate')
  await checked(
    'git',
    ['commit', '-m', `release: ${marketingVersion}`],
    'Cannot commit release candidate',
  )
  await clearReleaseDraft()
  await checked(
    'git',
    ['push', '--atomic', 'origin', 'HEAD:dev', 'HEAD:main'],
    'Cannot publish release candidate branches',
  )
  const sourceSha = (
    await checked('git', ['rev-parse', 'HEAD^{commit}'], 'Cannot resolve release candidate')
  ).toLowerCase()
  return { kind: 'prepared', marketingVersion, sourceSha }
}
