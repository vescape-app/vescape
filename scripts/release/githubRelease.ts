import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validateReleaseMarkdown } from '../release-notes/bundler'

export interface ReleaseCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface GithubReleaseDependencies {
  run?: (command: 'git' | 'gh', args: string[]) => Promise<ReleaseCommandResult>
}

async function runReleaseCommand(
  command: 'git' | 'gh',
  args: string[],
): Promise<ReleaseCommandResult> {
  const process = Bun.spawn([command, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

function requireCommand(result: ReleaseCommandResult, label: string): string {
  if (result.exitCode !== 0) throw new Error(`${label}: ${result.stderr || result.stdout}`)
  return result.stdout
}

/** Read the accepted canonical notes from the immutable source commit. */
export async function readCanonicalReleaseBody(
  sourceSha: string,
  marketingVersion: string,
  dependencies: GithubReleaseDependencies = {},
): Promise<string> {
  const run = dependencies.run ?? runReleaseCommand
  const notesPath = `release-notes/${marketingVersion}.md`
  const body = requireCommand(
    await run('git', ['show', `${sourceSha}:${notesPath}`]),
    `Cannot read canonical release notes ${notesPath} from ${sourceSha}`,
  )
  validateReleaseMarkdown(body, notesPath)
  return `${body}\n`
}

/**
 * The GitHub release is published from the release commit, before any build: the tag and the notes
 * describe the source, not the artifacts. Play upload outcomes live in the release manifest.
 */
export async function publishGithubRelease(
  repo: string,
  target: { marketingVersion: string; sourceSha: string },
  dependencies: GithubReleaseDependencies = {},
): Promise<'created' | 'existing'> {
  const run = dependencies.run ?? runReleaseCommand
  const tag = `v${target.marketingVersion}`
  const sourceSha = target.sourceSha.toLowerCase()

  requireCommand(await run('git', ['fetch', 'origin', '--tags']), 'Cannot refresh Git tags')
  requireCommand(
    await run('git', ['rev-parse', '--verify', `${sourceSha}^{commit}`]),
    'Release source commit is not available locally',
  )

  const remoteTag = requireCommand(
    await run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]),
    `Cannot inspect remote tag ${tag}`,
  )
  const remoteTagSha =
    remoteTag
      .split('\n')
      .find((line) => line.endsWith(`refs/tags/${tag}^{}`))
      ?.split(/\s+/)[0] ?? remoteTag.split(/\s+/)[0]
  if (remoteTagSha) {
    if (remoteTagSha.toLowerCase() !== sourceSha) {
      throw new Error(`Immutable tag ${tag} already points to ${remoteTagSha}, not ${sourceSha}`)
    }
  } else {
    const existingTag = await run('git', ['rev-parse', '--verify', `${tag}^{commit}`])
    if (existingTag.exitCode === 0) {
      if (existingTag.stdout.toLowerCase() !== sourceSha) {
        throw new Error(
          `Immutable tag ${tag} already points to ${existingTag.stdout}, not ${sourceSha}`,
        )
      }
    } else {
      requireCommand(await run('git', ['tag', tag, sourceSha]), `Cannot create tag ${tag}`)
    }
    requireCommand(
      await run('git', ['push', 'origin', `refs/tags/${tag}`]),
      `Cannot push tag ${tag}`,
    )
  }

  const existingRelease = await run('gh', [
    'release',
    'view',
    tag,
    '--repo',
    repo,
    '--json',
    'tagName',
    '--jq',
    '.tagName',
  ])
  if (existingRelease.exitCode === 0) return 'existing'

  const body = await readCanonicalReleaseBody(sourceSha, target.marketingVersion, {
    ...dependencies,
    run,
  })

  const directory = await mkdtemp(join(tmpdir(), 'vescape-github-release-'))
  try {
    const notesFile = join(directory, 'notes.md')
    await writeFile(notesFile, body)
    requireCommand(
      await run('gh', [
        'release',
        'create',
        tag,
        '--repo',
        repo,
        '--verify-tag',
        '--latest',
        '--notes-file',
        notesFile,
      ]),
      `Cannot create GitHub release ${tag}`,
    )
    return 'created'
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
