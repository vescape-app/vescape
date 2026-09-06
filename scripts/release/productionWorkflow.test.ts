import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..', '..')
const workflow = readFileSync(join(root, '.github/workflows/promote-production.yml'), 'utf8')
const internalWorkflow = readFileSync(join(root, '.github/workflows/release-android.yml'), 'utf8')
const fastfile = readFileSync(join(root, 'fastlane/Fastfile'), 'utf8')
const releaseEntry = readFileSync(join(root, 'scripts/release.ts'), 'utf8')
const releasePreparation = readFileSync(join(root, 'scripts/release/prepare.ts'), 'utf8')
const recordWorkflow = readFileSync(
  join(root, '.github/workflows/record-released-version.yml'),
  'utf8',
)

describe('production promotion workflow contract', () => {
  test('serializes Play writes and requires the production environment', () => {
    expect(workflow).toContain('group: play-publish')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).toContain('environment: production')
  })

  test('proves source, version, notes, manifest, and open state before mutation', () => {
    const validation = workflow.indexOf('Revalidate exact live Play state before mutation')
    const mutation = workflow.indexOf('Apply phone production operation')
    expect(validation).toBeGreaterThan(0)
    expect(validation).toBeLessThan(mutation)
    expect(workflow).toContain('git merge-base --is-ancestor "$SOURCE_SHA" origin/main')
    expect(workflow).toContain('git show "$SOURCE_SHA:package.json"')
    expect(workflow).toContain('git cat-file -e "$SOURCE_SHA:release-notes/$MARKETING_VERSION.md"')
    expect(workflow).toContain('promotion-manifest')
  })

  test('promotes exact codes without rebuilding or uploading binaries', () => {
    expect(fastfile).toContain('version_code: code')
    expect(fastfile).toContain('skip_upload_aab: true')
    expect(fastfile).toContain('track_promote_to: target_track')
    expect(workflow).not.toMatch(/gradle|expo prebuild|bundleRelease|\.aab/i)
  })

  // Staged rollout was removed deliberately: every promotion goes to 100% at once, so no
  // percentage, halt, resume or advance path may creep back into the Play calls.
  test('promotes to a completed release with no staged rollout path', () => {
    expect(fastfile).toContain('when "status"')
    expect(fastfile).toContain('track_promote_release_status: "completed"')
    expect(fastfile).not.toMatch(/rollout|user_fraction|when "halt"|when "resume"|when "advance"/)
    expect(workflow).not.toMatch(/rollout|percentage/i)
  })

  test('writes Fastlane results where the workflow assembles the manifest', () => {
    expect(workflow).toContain('PRODUCTION_RESULT_PATH: ${{ github.workspace }}/phone-result.json')
    expect(workflow).toContain('PRODUCTION_RESULT_PATH: ${{ github.workspace }}/wear-result.json')
  })

  test('flips existing prerelease to latest after Play success without creating anything', () => {
    expect(workflow).toContain('TAG="v$MARKETING_VERSION"')
    expect(workflow).toContain('test "$(git rev-parse "$TAG^{commit}")" = "$SOURCE_SHA"')
    expect(workflow).toContain('gh release edit "$TAG" --prerelease=false --latest')
    expect(workflow).toContain('echo already-released > github-release-status.txt')
    expect(workflow).not.toMatch(/git tag|git push|gh release create/)
    expect(workflow).not.toContain('--json body')
    expect(workflow.indexOf('Apply Wear production operation')).toBeLessThan(
      workflow.indexOf('Flip existing GitHub prerelease to latest release'),
    )
  })

  test('distinguishes skipped GitHub finalization from an attempted failure', () => {
    expect(workflow).toContain('elif test "$GITHUB_OUTCOME" = skipped; then')
    expect(workflow).toContain('echo skipped > github-release-status.txt')
  })

  // The server reports what the stores serve, so the push must follow a successful Play write
  // and must never fail a release that already reached production.
  test('tells the server about the Android version only after Play succeeded', () => {
    const play = workflow.indexOf('Apply Wear production operation')
    const push = workflow.indexOf('Tell the server Android now serves this version')
    expect(play).toBeGreaterThan(0)
    expect(push).toBeGreaterThan(play)
    expect(workflow).toContain('bun run scripts/release/releasedVersion.ts android')
    expect(workflow.slice(push)).toContain('continue-on-error: true')
    expect(workflow).toContain('INTERNAL_API_KEY: ${{ secrets.VESCAPE_INTERNAL_API_KEY }}')
  })

  // No store credential belongs in the server repository: it learns the version from here.
  test('records iOS by hand, since nothing here releases it to the App Store', () => {
    expect(recordWorkflow).toContain('options: [ios, android]')
    expect(recordWorkflow).toContain(
      'git merge-base --is-ancestor "v$VERSION^{commit}" origin/main',
    )
    expect(recordWorkflow).toContain('bun run scripts/release/releasedVersion.ts')
  })

  test('has no legacy or hidden second production path', () => {
    expect(internalWorkflow).not.toContain("tags: ['production-*']")
    expect(releaseEntry).not.toMatch(/production-|git tag|promote-production/)
    expect(releasePreparation).not.toMatch(/production-|git tag|gh release|fastlane/)
  })
})
