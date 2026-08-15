import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateGithubReleaseBody } from '../release-notes/codex'
import type { ReleaseManifest } from './contracts'
import { releaseOutcome } from './contracts'

export interface ReleaseCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface GithubPrereleaseDependencies {
  run?: (command: 'git' | 'gh', args: string[]) => Promise<ReleaseCommandResult>
  generateBody?: typeof generateGithubReleaseBody
  root?: string
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

export async function publishGithubPrerelease(
  repo: string,
  manifest: ReleaseManifest,
  dependencies: GithubPrereleaseDependencies = {},
): Promise<'created' | 'existing'> {
  if (releaseOutcome(manifest).kind !== 'success') {
    throw new Error('Cannot publish a GitHub prerelease for an unsuccessful internal release')
  }

  const run = dependencies.run ?? runReleaseCommand
  const generateBody = dependencies.generateBody ?? generateGithubReleaseBody
  const tag = `v${manifest.marketingVersion}`
  const sourceSha = manifest.sourceSha.toLowerCase()

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

  const root =
    dependencies.root ??
    requireCommand(await run('git', ['rev-parse', '--show-toplevel']), 'Cannot resolve repository')
  const previous = await run('git', [
    'describe',
    '--tags',
    '--match',
    'v*',
    '--abbrev=0',
    `${sourceSha}^`,
  ])
  const previousTag = previous.exitCode === 0 && previous.stdout ? previous.stdout : null
  const range = previousTag ? `${previousTag}..${sourceSha}` : sourceSha
  const commitLog = requireCommand(
    await run('git', ['log', '--no-merges', '--max-count=200', '--format=- %s (%h)', range]),
    'Cannot build GitHub release commit log',
  )
  if (!commitLog) throw new Error(`No commits found for GitHub release ${tag}`)

  const directory = await mkdtemp(join(tmpdir(), 'vescape-github-release-'))
  try {
    const notesFile = join(directory, 'notes.md')
    const body = await generateBody({
      root,
      outputFile: notesFile,
      version: manifest.marketingVersion,
      previousTag,
      commitLog,
    })
    await writeFile(notesFile, body)
    requireCommand(
      await run('gh', [
        'release',
        'create',
        tag,
        '--repo',
        repo,
        '--verify-tag',
        '--prerelease',
        '--notes-file',
        notesFile,
      ]),
      `Cannot create GitHub prerelease ${tag}`,
    )
    return 'created'
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
