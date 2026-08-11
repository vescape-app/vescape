import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..', '..')
const workflow = readFileSync(join(root, '.github/workflows/promote-open.yml'), 'utf8')
const fastfile = readFileSync(join(root, 'fastlane/Fastfile'), 'utf8')

describe('open-promotion workflow contract', () => {
  test('serializes with Play publishing and validates before mutation', () => {
    expect(workflow).toContain('group: play-publish')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).toContain('needs: validate')
    expect(workflow.indexOf('Validate both exact artifacts before any mutation')).toBeLessThan(
      workflow.indexOf('Promote exact phone code'),
    )
  })

  test('does not require release notes before open promotion', () => {
    expect(workflow).not.toContain('release-notes/$MARKETING_VERSION.md')
  })

  test('passes exact version codes without build or binary upload commands', () => {
    const promotionHelper = fastfile.slice(
      fastfile.indexOf('def promote_exact_artifact'),
      fastfile.indexOf('platform :android'),
    )
    expect(promotionHelper).toContain('version_code: code')
    expect(promotionHelper).toContain('skip_upload_apk: true')
    expect(promotionHelper).toContain('skip_upload_aab: true')
    expect(workflow).not.toMatch(/gradle|expo prebuild|bundleRelease|\.aab/i)
  })

  test('records phone and Wear results independently for safe retry', () => {
    expect(workflow).toContain('status:"failed"')
    expect(workflow).toContain('PROMOTION_RESULT_PATH: ${{ github.workspace }}/phone-result.json')
    expect(workflow).toContain('PROMOTION_RESULT_PATH: ${{ github.workspace }}/wear-result.json')
    expect(workflow).toContain('--slurpfile phone phone-result.json')
    expect(workflow).toContain('--slurpfile wear wear-result.json')
    expect(fastfile).toContain('"already-open"')
  })
})
