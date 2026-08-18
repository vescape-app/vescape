import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const workflow = readFileSync(
  join(import.meta.dir, '../../.github/workflows/release-android.yml'),
  'utf8',
)

describe('internal release workflow contract', () => {
  test('publishes tag and release only after both internal uploads succeed', () => {
    expect(workflow).toMatch(/permissions:\n\s+contents: read/)
    const job = workflow.slice(workflow.indexOf('  github_release:'))
    expect(job).toContain('needs: [build, upload_phone, upload_wear]')
    expect(job).toMatch(/permissions:\n\s+contents: write/)
    expect(job).not.toContain('if: always()')
    expect(job).toContain('git push origin "refs/tags/$TAG"')
    expect(job).toContain('--verify-tag --latest --notes-file release-body.md')
    expect(job).not.toContain('--prerelease')
  })

  test('publishes the body drafted before dispatch instead of running Codex in CI', () => {
    expect(workflow).toContain('release_body:')
    expect(workflow).toContain('RELEASE_BODY: ${{ inputs.release_body }}')
    expect(workflow).not.toContain('codex')
  })

  test('restores downloaded AABs under the paths expected by Fastlane', () => {
    const downloads = workflow.match(
      /uses: actions\/download-artifact@v4\n\s+with:\n\s+name: signed-aabs\n\s+path: android/g,
    )
    expect(downloads).toHaveLength(2)
  })
})
