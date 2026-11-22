import type { ReleaseManifest } from '../contracts'

export async function sendToOpenTesting(
  candidate: ReleaseManifest,
  checkNotes: (candidate: ReleaseManifest) => Promise<string>,
  send: (candidate: ReleaseManifest, notesPath: string) => Promise<void>,
): Promise<void> {
  if (candidate.uploads.phone !== 'succeeded' || candidate.uploads.wear !== 'succeeded') {
    throw new Error(
      'Both phone and watch must finish uploading before sending this build to Open testing.',
    )
  }
  const notesPath = await checkNotes(candidate)
  await send(candidate, notesPath)
}
