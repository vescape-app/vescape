import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const workflow = readFileSync(
  join(import.meta.dir, '../../.github/workflows/release-android.yml'),
  'utf8',
)

describe('internal release workflow contract', () => {
  test('leaves GitHub releases to the CLI and keeps read-only contents', () => {
    expect(workflow).toMatch(/permissions:\n\s+contents: read/)
    expect(workflow).not.toContain('github_release:')
    expect(workflow).not.toContain('gh release create')
    expect(workflow).not.toContain('codex')
  })

  test('restores downloaded AABs under the paths expected by Fastlane', () => {
    const downloads = workflow.match(
      /uses: actions\/download-artifact@v4\n\s+with:\n\s+name: signed-aabs\n\s+path: android/g,
    )
    expect(downloads).toHaveLength(2)
  })
})
