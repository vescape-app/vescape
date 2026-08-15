import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const workflow = readFileSync(
  join(import.meta.dir, '../../.github/workflows/release-android.yml'),
  'utf8',
)

describe('internal release workflow contract', () => {
  test('keeps tag and GitHub Release writes outside CI', () => {
    expect(workflow).toMatch(/permissions:\n\s+contents: read/)
    expect(workflow).not.toMatch(/git tag|git push|gh release/)
  })

  test('restores downloaded AABs under the paths expected by Fastlane', () => {
    const downloads = workflow.match(
      /uses: actions\/download-artifact@v4\n\s+with:\n\s+name: signed-aabs\n\s+path: android/g,
    )
    expect(downloads).toHaveLength(2)
  })
})
