#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { sentryAppDelegateInitProblems, sentryManifestInitProblems } from './productionConfig.ts'

const [path] = process.argv.slice(2)

if (!path) {
  console.error('Usage: verifySentryNativeInit.ts <merged-AndroidManifest.xml | AppDelegate.swift>')
  process.exit(1)
}

const source = readFileSync(path, 'utf8')
const problems = path.endsWith('.swift')
  ? sentryAppDelegateInitProblems(source)
  : sentryManifestInitProblems(source)

if (problems.length > 0) {
  console.error(
    `Release artifact would ship without native Sentry init (${path}):\n${problems
      .map((problem) => `  - ${problem}`)
      .join('\n')}`,
  )
  process.exit(1)
}

console.log(`Sentry starts natively before JS (${path}).`)
