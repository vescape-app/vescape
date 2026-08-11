import { readFile } from 'node:fs/promises'

export function threadIdFromJsonl(output: string): string {
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (
      event &&
      typeof event === 'object' &&
      (event as { type?: unknown }).type === 'thread.started' &&
      typeof (event as { thread_id?: unknown }).thread_id === 'string'
    ) {
      return (event as { thread_id: string }).thread_id
    }
  }
  throw new Error('Codex did not report a thread ID')
}

export async function runCodexDraft(options: {
  root: string
  outputFile: string
  prompt: string
  threadId?: string
}): Promise<{ markdown: string; threadId: string }> {
  const args = options.threadId
    ? [
        'exec',
        'resume',
        '--config',
        'sandbox_mode="read-only"',
        '--json',
        '--output-last-message',
        options.outputFile,
        options.threadId,
        options.prompt,
      ]
    : [
        'exec',
        '--sandbox',
        'read-only',
        '--json',
        '--output-last-message',
        options.outputFile,
        '--cd',
        options.root,
        options.prompt,
      ]
  const child = Bun.spawn(['codex', ...args], {
    cwd: options.root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Codex failed: ${stderr.trim() || stdout.trim()}`)
  return {
    markdown: await readFile(options.outputFile, 'utf8'),
    threadId: options.threadId ?? threadIdFromJsonl(stdout),
  }
}

export async function generateGithubReleaseBody(options: {
  root: string
  outputFile: string
  version: string
  previousTag: string | null
  commitLog: string
}): Promise<string> {
  const range = options.previousTag
    ? `${options.previousTag}..v${options.version}`
    : 'repository start'
  const result = await runCodexDraft({
    root: options.root,
    outputFile: options.outputFile,
    prompt: [
      `Write the GitHub prerelease body for Vescape v${options.version}.`,
      `Source range: ${range}.`,
      'Turn the commit log below into concise, human-friendly Markdown release notes.',
      'Group related user-visible changes. Mention technical work only when useful to users.',
      'Do not invent behavior, include commit hashes, add a title, or use a preamble.',
      'Return only the complete Markdown body.',
      '',
      options.commitLog,
    ].join('\n'),
  })
  const markdown = result.markdown.trim()
  if (!markdown) throw new Error('Codex generated an empty GitHub release body')
  return `${markdown}\n`
}
