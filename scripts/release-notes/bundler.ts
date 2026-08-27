import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import MarkdownIt from 'markdown-it'

import {
  compareMarketingVersions,
  parseMarketingVersion,
  type BundledReleaseNote,
} from '../../src/modules/release/lib/releaseNotes'

const markdown = new MarkdownIt('default', { html: true })
const ROOT = join(import.meta.dir, '../..')
export const RELEASE_NOTES_DIRECTORY = join(ROOT, 'release-notes')
export const GENERATED_RELEASE_NOTES_PATH = 'src/modules/release/generated/releaseNotes.ts'
export const GENERATED_RELEASE_NOTES_FILE = join(ROOT, GENERATED_RELEASE_NOTES_PATH)
const OXFMT_BINARY = join(ROOT, 'node_modules/.bin/oxfmt')

export interface CanonicalReleaseNote extends BundledReleaseNote {
  fileName: string
}

export function validateReleaseMarkdown(source: string, label = 'Release note'): void {
  if (!source.trim()) throw new Error(`${label} is empty`)
  const tokens = markdown.parse(source, {})
  const allTokens = tokens.flatMap((token) => [token, ...(token.children ?? [])])
  const unsupported = allTokens.find((token) =>
    ['html_block', 'html_inline', 'code_block', 'fence', 'image', 'table_open'].includes(
      token.type,
    ),
  )
  if (unsupported) throw new Error(`${label} uses unsupported Markdown (${unsupported.type})`)
  const allowedSections = ['New', 'Improved', 'Fixed']
  const sections = tokens.flatMap((token, index) => {
    if (token.type !== 'heading_open') return []
    const name = tokens[index + 1]?.type === 'inline' ? tokens[index + 1].content.trim() : ''
    if (token.tag !== 'h2' || !allowedSections.includes(name)) {
      throw new Error(`${label} contains unsupported section heading "${name}"`)
    }
    return [name]
  })
  if (new Set(sections).size !== sections.length) throw new Error(`${label} repeats a section`)
  const indexes = sections.map((section) => allowedSections.indexOf(section))
  if (indexes.some((index, position) => position > 0 && index <= indexes[position - 1])) {
    throw new Error(`${label} sections must be ordered New, Improved, Fixed`)
  }
}

export function compileReleaseNotes(notes: readonly CanonicalReleaseNote[]): string {
  const versions = new Set<string>()
  for (const note of notes) {
    if (!parseMarketingVersion(note.version) || note.fileName !== `${note.version}.md`) {
      throw new Error(`${note.fileName} is not named with a marketing version (X.Y.Z.md)`)
    }
    if (versions.has(note.version))
      throw new Error(`Duplicate release-note version ${note.version}`)
    versions.add(note.version)
    validateReleaseMarkdown(note.markdown, note.fileName)
  }

  const sorted = notes.toSorted((left, right) =>
    compareMarketingVersions(right.version, left.version),
  )
  const rows = sorted
    .map(
      ({ version, markdown: body }) =>
        `  { version: ${JSON.stringify(version)}, markdown: ${JSON.stringify(body)} },`,
    )
    .join('\n')
  return [
    "import type { BundledReleaseNote } from '../lib/releaseNotes'",
    '',
    'export const bundledReleaseNotes = [',
    rows,
    '] as const satisfies readonly BundledReleaseNote[]',
    '',
  ].join('\n')
}

export async function readCanonicalReleaseNotes(): Promise<CanonicalReleaseNote[]> {
  const entries = await readdir(RELEASE_NOTES_DIRECTORY, { withFileTypes: true })
  const markdownFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  return Promise.all(
    markdownFiles.map(async ({ name }) => ({
      fileName: name,
      version: name.slice(0, -3),
      markdown: await readFile(join(RELEASE_NOTES_DIRECTORY, name), 'utf8'),
    })),
  )
}

/**
 * The generated module is committed, so its bytes must survive a formatter pass. Formatting here
 * keeps oxfmt the single style authority and stops `release-notes:check` from drifting the moment
 * anything else formats the file.
 */
async function formatGenerated(source: string): Promise<string> {
  const child = Bun.spawn([OXFMT_BINARY, `--stdin-filepath=${GENERATED_RELEASE_NOTES_FILE}`], {
    cwd: ROOT,
    stdin: new TextEncoder().encode(source),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Cannot format bundled release notes: ${stderr.trim()}`)
  return stdout
}

export async function expectedBundledReleaseNotes(): Promise<string> {
  return formatGenerated(compileReleaseNotes(await readCanonicalReleaseNotes()))
}

export async function buildReleaseNotes(): Promise<void> {
  const output = await expectedBundledReleaseNotes()
  await mkdir(dirname(GENERATED_RELEASE_NOTES_FILE), { recursive: true })
  await writeFile(GENERATED_RELEASE_NOTES_FILE, output)
}

export async function checkReleaseNotes(): Promise<void> {
  const expected = await expectedBundledReleaseNotes()
  let actual: string | null
  try {
    actual = await readFile(GENERATED_RELEASE_NOTES_FILE, 'utf8')
  } catch {
    actual = null
  }
  validateGeneratedReleaseNotes(actual, expected)
}

export function validateGeneratedReleaseNotes(actual: string | null, expected: string): void {
  if (actual === null) {
    throw new Error('Bundled release notes are missing; run `bun run release-notes:build`')
  }
  if (actual !== expected) {
    throw new Error('Bundled release notes are stale; run `bun run release-notes:build`')
  }
}
