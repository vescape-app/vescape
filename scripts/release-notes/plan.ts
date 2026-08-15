import { parseMarketingVersion } from '../../src/modules/release/lib/releaseNotes'

export interface ReleaseTag {
  tagName: string
  sha: string
}

export interface ReleaseNotePlan {
  targetSha: string
  targetRef: string
  marketingVersion: string
  previous: ReleaseTag | null
  comparison: string
  diffBase: string
}

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function command(program: string, args: string[]): Promise<CommandResult> {
  const child = Bun.spawn([program, ...args], { cwd: joinRoot(), stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

function joinRoot(): string {
  return new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
}

async function checked(program: string, args: string[], label: string): Promise<string> {
  const result = await command(program, args)
  if (result.exitCode !== 0) throw new Error(`${label}: ${result.stderr || result.stdout}`)
  return result.stdout
}

/** Candidate bases: every version tag this repo cuts, prerelease (`v*`) or production. */
// Annotated tags resolve through the dereferenced commit; lightweight tags point at it directly.
export function parseReleaseTags(value: string): ReleaseTag[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [tagName, objectName, dereferenced] = line.split(' ')
      if (!tagName || !objectName) throw new Error(`Invalid tag metadata "${line}"`)
      const sha = dereferenced || objectName
      return /^(v|production-)\d+\.\d+\.\d+$/.test(tagName)
        ? [{ tagName, sha: sha.toLowerCase() }]
        : []
    })
}

export async function resolveReleaseNotePlan(
  targetRef: string,
  versionOverride?: string,
): Promise<ReleaseNotePlan> {
  const targetSha = (
    await checked(
      'git',
      ['rev-parse', '--verify', `${targetRef}^{commit}`],
      'Cannot resolve target',
    )
  ).toLowerCase()
  const packageJson = JSON.parse(
    await checked('git', ['show', `${targetSha}:package.json`], 'Cannot read target package.json'),
  ) as { version?: unknown }
  const marketingVersion = versionOverride ?? packageJson.version
  if (typeof marketingVersion !== 'string' || !parseMarketingVersion(marketingVersion)) {
    throw new Error(`Invalid marketing version "${String(marketingVersion)}"`)
  }

  const tags = parseReleaseTags(
    await checked(
      'git',
      ['for-each-ref', '--format=%(refname:short) %(objectname) %(*objectname)', 'refs/tags/*'],
      'Cannot list release tags',
    ),
  )
  let previous: ReleaseTag | null = null
  let previousDistance = Number.POSITIVE_INFINITY
  for (const tag of tags) {
    if (tag.sha === targetSha) continue
    const ancestor = await command('git', ['merge-base', '--is-ancestor', tag.sha, targetSha])
    if (ancestor.exitCode !== 0) continue
    const distanceResult = await command('git', ['rev-list', '--count', `${tag.sha}..${targetSha}`])
    const distance = Number(distanceResult.stdout)
    if (
      distanceResult.exitCode === 0 &&
      Number.isSafeInteger(distance) &&
      distance < previousDistance
    ) {
      previous = tag
      previousDistance = distance
    }
  }

  const diffBase = previous
    ? previous.sha
    : await checked('git', ['hash-object', '-t', 'tree', '/dev/null'], 'Cannot create empty tree')
  return {
    targetSha,
    targetRef,
    marketingVersion,
    previous,
    comparison: previous ? `${previous.tagName}..${targetSha}` : `<beginning>..${targetSha}`,
    diffBase,
  }
}
