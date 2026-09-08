import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { VersionBump } from './prepare'

const draftPath = () =>
  process.env.VESCAPE_RELEASE_DRAFT_PATH ??
  join(homedir(), 'Library', 'Caches', 'vescape', 'release-draft.json')

export interface SavedReleaseDraft {
  sourceSha: string
  baseVersion: string
  bump: VersionBump
  markdown: string
  threadId: string
}

export async function loadReleaseDraft(
  sourceSha: string,
  baseVersion: string,
): Promise<SavedReleaseDraft | null> {
  try {
    const draft = JSON.parse(await readFile(draftPath(), 'utf8')) as SavedReleaseDraft
    return draft.sourceSha === sourceSha && draft.baseVersion === baseVersion ? draft : null
  } catch {
    return null
  }
}

export async function saveReleaseDraft(draft: SavedReleaseDraft): Promise<void> {
  const path = draftPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(draft)}\n`, { mode: 0o600 })
}

export async function clearReleaseDraft(): Promise<void> {
  await rm(draftPath(), { force: true })
}
