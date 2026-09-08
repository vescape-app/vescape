import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { buildReleaseNotes, validateReleaseMarkdown } from './bundler'
import { runCodexDraft } from './codex'
import { selectPrompt, textPrompt } from './prompt'

export async function reviewReleaseNoteDraft(options: {
  root: string
  destination: string
  label: string
  editorCommand: string[]
  initialPrompt: string
  replace?: boolean
  persist?: boolean
  initialDraft?: { markdown: string; threadId: string }
  allowVersionChange?: boolean
  acceptLabel?: string
  onDraft?: (draft: { markdown: string; threadId: string }) => void | Promise<void>
  select?: (title: string, options: readonly { value: string; label: string }[]) => Promise<string>
}): Promise<
  | { kind: 'accepted'; markdown: string; threadId: string }
  | { kind: 'change-version'; markdown: string; threadId: string }
  | { kind: 'discarded' }
  | { kind: 'paused' }
> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vescape-release-notes-'))
  const draftFile = join(temporaryDirectory, 'draft.md')

  try {
    let result = options.initialDraft
    if (!result) {
      console.log('\nAsking local Codex to inspect the compared changes…')
      const startedAt = Date.now()
      const progress = setInterval(() => {
        console.log(`Still drafting… ${Math.round((Date.now() - startedAt) / 1_000)}s`)
      }, 15_000)
      try {
        result = await runCodexDraft({
          root: options.root,
          outputFile: draftFile,
          prompt: options.initialPrompt,
        })
      } finally {
        clearInterval(progress)
      }
      console.log(`Draft ready in ${Math.round((Date.now() - startedAt) / 1_000)}s`)
    } else {
      await writeFile(draftFile, result.markdown)
    }
    await options.onDraft?.(result)

    while (true) {
      preview(result.markdown)
      let choice
      try {
        choice = await (options.select ?? selectPrompt)('Review release-note draft', [
          { value: 'accept', label: options.acceptLabel ?? 'Accept canonical notes' },
          { value: 'revise', label: 'Revise with Codex' },
          { value: 'edit', label: `Edit in ${options.editorCommand[0]}` },
          ...(options.allowVersionChange
            ? [{ value: 'change-version' as const, label: 'Change patch / minor / major' }]
            : []),
          { value: 'discard', label: 'Cancel release' },
        ] as const)
      } catch (error) {
        if (error instanceof Error && error.message === 'Selection cancelled') {
          return { kind: 'paused' }
        }
        throw error
      }

      if (choice === 'discard') {
        console.log('Draft discarded; canonical release notes unchanged')
        return { kind: 'discarded' }
      }
      if (choice === 'change-version') {
        return { kind: 'change-version', ...result }
      }
      if (choice === 'edit') {
        try {
          await openEditor(draftFile, options.editorCommand)
          result = { ...result, markdown: await readFile(draftFile, 'utf8') }
          await options.onDraft?.(result)
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error))
        }
        continue
      }
      if (choice === 'revise') {
        const instruction = await textPrompt('How should Codex revise the draft?')
        if (!instruction) continue
        result = await runCodexDraft({
          root: options.root,
          outputFile: draftFile,
          threadId: result.threadId,
          prompt: `Revise the release-note draft. Return only the complete Markdown replacement.\n\nAuthor instruction: ${instruction}\n\nCurrent draft:\n${result.markdown}`,
        })
        await options.onDraft?.(result)
        continue
      }

      try {
        validateReleaseMarkdown(result.markdown, options.label)
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        continue
      }
      if (options.persist !== false) {
        await mkdir(dirname(options.destination), { recursive: true })
        await writeFile(options.destination, ensureTrailingNewline(result.markdown), {
          flag: options.replace ? 'w' : 'wx',
        })
        await buildReleaseNotes()
        console.log(`Accepted ${options.destination}`)
      }
      return {
        kind: 'accepted',
        markdown: ensureTrailingNewline(result.markdown),
        threadId: result.threadId,
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export async function openEditor(file: string, [program, ...args]: string[]): Promise<void> {
  const child = Bun.spawn([program, ...args, file], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Editor exited with code ${exitCode}`)
}

function preview(source: string): void {
  console.log('\n----- draft preview -----')
  console.log(source.trimEnd())
  console.log('----- end draft -----')
}

function ensureTrailingNewline(source: string): string {
  return `${source.trimEnd()}\n`
}
