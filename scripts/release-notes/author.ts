#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildReleaseNotes, RELEASE_NOTES_DIRECTORY, validateReleaseMarkdown } from './bundler'
import { resolveEditorCommand } from './editor'
import { resolveReleaseNotePlan } from './plan'
import { releaseNotesPrompt } from './draftPrompt'
import { reviewReleaseNoteDraft } from './review'

const ROOT = join(import.meta.dir, '../..')
const targetRef = argument('sha') ?? 'HEAD'
const versionOverride = argument('version')

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error('Release-note authoring requires an interactive terminal')
}

const plan = await resolveReleaseNotePlan(targetRef, versionOverride)
const editorCommand = resolveEditorCommand()
const destination = join(RELEASE_NOTES_DIRECTORY, `${plan.marketingVersion}.md`)
if (await Bun.file(destination).exists()) {
  validateReleaseMarkdown(await readFile(destination, 'utf8'), `${plan.marketingVersion}.md`)
  await buildReleaseNotes()
  console.log(`Using existing ${destination}`)
  process.exit(0)
}

console.log('Release-note plan')
console.log(`  Previous release: ${plan.previous ? plan.previous.tagName : 'none'}`)
console.log(`  Target SHA: ${plan.targetSha}`)
console.log(`  Marketing version: ${plan.marketingVersion}`)
console.log(`  Compared range: ${plan.comparison}`)
console.log(`  Editor: ${editorCommand.join(' ')}`)

await reviewReleaseNoteDraft({
  root: ROOT,
  destination,
  label: `${plan.marketingVersion}.md`,
  editorCommand,
  initialPrompt: releaseNotesPrompt(plan),
})

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}
