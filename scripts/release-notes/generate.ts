#!/usr/bin/env bun

import { buildReleaseNotes, checkReleaseNotes, GENERATED_RELEASE_NOTES_FILE } from './bundler'

if (process.argv.includes('--check')) {
  await checkReleaseNotes()
  console.log('Bundled release notes are current')
} else {
  await buildReleaseNotes()
  console.log(`Generated ${GENERATED_RELEASE_NOTES_FILE}`)
}
