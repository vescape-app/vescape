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
}): Promise<'accepted' | 'discarded'> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vescape-release-notes-'))
  const draftFile = join(temporaryDirectory, 'draft.md')

  try {
    console.log('\nAsking local Codex to inspect the compared changes…')
    let result = await runCodexDraft({
      root: options.root,
      outputFile: draftFile,
      prompt: options.initialPrompt,
    })

    while (true) {
      preview(result.markdown)
      const choice = await selectPrompt('Review release-note draft', [
        { value: 'accept', label: 'Accept canonical notes', shortcut: 'a' },
        { value: 'revise', label: 'Revise with Codex', shortcut: 'r' },
        { value: 'edit', label: `Edit in ${options.editorCommand[0]}`, shortcut: 'e' },
        { value: 'discard', label: 'Discard draft', shortcut: 'd' },
      ] as const)

      if (choice === 'discard') {
        console.log('Draft discarded; canonical release notes unchanged')
        return 'discarded'
      }
      if (choice === 'edit') {
        try {
          await openEditor(draftFile, options.editorCommand)
          result = { ...result, markdown: await readFile(draftFile, 'utf8') }
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
        continue
      }

      try {
        validateReleaseMarkdown(result.markdown, options.label)
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        continue
      }
      await mkdir(dirname(options.destination), { recursive: true })
      await writeFile(options.destination, ensureTrailingNewline(result.markdown), {
        flag: options.replace ? 'w' : 'wx',
      })
      await buildReleaseNotes()
      console.log(`Accepted ${options.destination}`)
      return 'accepted'
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
