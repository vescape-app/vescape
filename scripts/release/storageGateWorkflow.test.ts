import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..', '..')
const readWorkflow = (name: string) => readFileSync(join(root, '.github/workflows', name), 'utf8')

const job = (workflow: string, name: string) => {
  const start = workflow.indexOf(`\n  ${name}:`)
  if (start < 0) throw new Error(`Missing job ${name}`)
  const next = workflow.slice(start + 1).search(/\n  [a-z][a-z0-9_-]*:/)
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next)
}

describe('native storage release gate', () => {
  const reusable = readWorkflow('persistence-contracts.yml')
  const ci = readWorkflow('ci.yml')
  const android = readWorkflow('release-android.yml')
  const ios = readWorkflow('release-ios.yml')
  const open = readWorkflow('promote-open.yml')
  const production = readWorkflow('promote-production.yml')

  test('runs the complete cross-platform exchange at the exact requested commit', () => {
    expect(reusable).toContain('ref: ${{ inputs.source_sha }}')
    expect(reusable).toContain('test "$(git rev-parse HEAD)" = "$SOURCE_SHA"')
    expect(reusable).toContain('migration-fixture-manifest.json')
    expect(reusable).toContain("VESCAPE_BACKUP_PHASE: 'export-android'")
    expect(reusable).toContain("VESCAPE_BACKUP_PHASE: 'import-ios'")
    expect(reusable).toContain('run: bun run scripts/test-persistence.ts')
    expect(reusable).not.toContain('run: bun run test:persistence\n')
    expect(reusable).not.toContain('continue-on-error')
    expect(ci).toContain('source_sha: ${{ github.sha }}')
  })

  test('makes both publishing jobs depend on the aggregate host gate', () => {
    for (const workflow of [android, ios]) {
      expect(job(workflow, 'persistence-contracts')).toContain('persistence-contracts.yml')
      expect(job(workflow, 'persistence-contracts')).toContain(
        'source_sha: ${{ inputs.source_sha }}',
      )
      expect(job(workflow, 'build')).toContain('needs: [gates, persistence-contracts]')
    }
  })

  test('validates recorded attestations without retroactively requiring them on old builds', () => {
    const attestation = '.storageContracts.crossPlatformArchives'
    const openProof = open.indexOf(attestation)
    const productionProof = production.indexOf(attestation)
    expect(openProof).toBeGreaterThan(0)
    expect(openProof).toBeLessThan(open.indexOf('Write Play credentials'))
    expect(productionProof).toBeGreaterThan(0)
    expect(productionProof).toBeLessThan(production.indexOf('Write Play credentials'))
    for (const workflow of [open, production]) {
      expect(workflow).toContain(
        `if jq -e 'has("storageContracts")' candidate/release-manifest.json > /dev/null; then`,
      )
      expect(workflow).toContain(
        'test "$(jq -r .storageContracts.sourceSha candidate/release-manifest.json)" = "$SOURCE_SHA"',
      )
      expect(workflow).toContain(
        'test "$(jq -r .storageContracts.androidRoom candidate/release-manifest.json)" = passed',
      )
      expect(workflow).toContain(
        'test "$(jq -r .storageContracts.iosGrdb candidate/release-manifest.json)" = passed',
      )
    }
  })
})
