#!/usr/bin/env bun
import { missingProductionConfig, REQUIRED_PRODUCTION_ENV } from './productionConfig.ts'

const missing = missingProductionConfig(process.env)

if (missing.length > 0) {
  console.error(
    `Production release configuration is incomplete. Missing repository secrets:\n${missing
      .map((name) => `  - ${name}`)
      .join('\n')}\n` +
      'Set them before releasing; a build without these ships crashing or unmonitored.',
  )
  process.exit(1)
}

console.log(`Production configuration complete (${REQUIRED_PRODUCTION_ENV.length} values set).`)
