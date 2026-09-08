#!/usr/bin/env bun
import { runReleaseCli, type ReleaseCliOptions } from './release/cli'
import { prepareReleaseCandidate } from './release/prepare'

let options: ReleaseCliOptions = {}
while (true) {
  const result = await runReleaseCli(options)
  if (result.kind !== 'prepare') break
  try {
    const prepared = await prepareReleaseCandidate(result.bump)
    if (prepared.kind === 'discarded') {
      console.log('\nRelease draft discarded; working tree unchanged')
      options = {}
      continue
    }
    if (prepared.kind === 'paused') {
      console.log('\nDraft saved; working tree unchanged')
      options = {}
      continue
    }
    console.log(`\n✓ Prepared and pushed v${prepared.marketingVersion}`)
    options = { initialPhase: 'build-source', initialSourceRef: prepared.sourceSha }
  } catch (error) {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    break
  }
}
