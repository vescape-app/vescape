#!/usr/bin/env bun

import { $ } from 'bun'
import { basename, join } from 'path'
import { tmpdir } from 'os'

const args = process.argv.slice(2)
const prFlag = args.indexOf('--pr')
const cleanFlag = args.includes('--clean')
const imagePath = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--pr')

const repo = (await $`gh repo view --json nameWithOwner -q .nameWithOwner`.text()).trim()

if (cleanFlag) {
  const releases = (await $`gh release list --json tagName -q '.[].tagName'`.text())
    .trim()
    .split('\n')
    .filter((t) => t.startsWith('pr-') && t.endsWith('-screenshots'))

  for (const tag of releases) {
    const prNum = tag.replace('pr-', '').replace('-screenshots', '')
    const result = await $`gh pr view ${prNum} --json state -q .state`.nothrow().quiet()
    if (result.exitCode !== 0) {
      console.error(`Could not inspect PR ${prNum}; keeping ${tag}.`)
      continue
    }
    const state = result.stdout.toString().trim()

    if (state === 'MERGED' || state === 'CLOSED') {
      await $`gh release delete ${tag} --yes --cleanup-tag`.quiet()
      console.error(`Cleaned up ${tag} (PR ${state})`)
    }
  }
  process.exit(0)
}

if (!imagePath) {
  console.error('Usage: bun run scripts/gh-upload-screenshot.ts <image> [--pr <number>]')
  console.error('       bun run scripts/gh-upload-screenshot.ts --clean')
  process.exit(1)
}

const file = Bun.file(imagePath)
if (!(await file.exists())) {
  console.error(`File not found: ${imagePath}`)
  process.exit(1)
}

let prNumber: string
if (prFlag !== -1 && args[prFlag + 1]) {
  prNumber = args[prFlag + 1]
} else {
  prNumber = (await $`gh pr view --json number -q .number`.text().catch(() => '')).trim()
  if (!prNumber) {
    console.error('No PR found for current branch. Use --pr <number>')
    process.exit(1)
  }
}

const tag = `pr-${prNumber}-screenshots`
const timestamp = Date.now()
const ext = basename(imagePath).match(/\.(\w+)$/)?.[1] ?? 'png'
const uniqueName = `screenshot-${timestamp}.${ext}`
const tmpFile = join(tmpdir(), uniqueName)

await $`cp ${imagePath} ${tmpFile}`

const existingRelease = await $`gh release view ${tag} --json tagName`.quiet().nothrow()

if (existingRelease.exitCode !== 0) {
  await $`gh release create ${tag} --title ${'PR #' + prNumber + ' screenshots'} --notes ${'Auto-generated screenshot assets for PR #' + prNumber} --prerelease`.quiet()
}

await $`gh release upload ${tag} ${tmpFile} --clobber`.quiet()
await $`rm ${tmpFile}`

const url = (
  await $`gh api repos/${repo}/releases/tags/${tag} --jq ${`.assets[] | select(.name=="${uniqueName}") | .browser_download_url`}`.text()
).trim()

console.log(`![screenshot](${url})`)
