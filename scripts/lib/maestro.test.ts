import { afterEach, beforeEach, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { MAESTRO_VERSION } from './maestro.ts'

let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'maestro-version-test-'))
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

async function commandWithVersion(version: string | null, exitCode = 0) {
  if (version !== null) {
    const binary = join(directory, 'maestro')
    writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' '${version}'\nexit ${exitCode}\n`)
    chmodSync(binary, 0o755)
  }
  const proc = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `import { maestroCommand } from ${JSON.stringify(join(import.meta.dir, 'maestro.ts'))}; console.log(JSON.stringify(await maestroCommand('test', 'flow.yaml')));`,
    ],
    { env: { ...process.env, PATH: directory }, stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, code }
}

test('pinned Maestro produces the requested command', async () => {
  const result = await commandWithVersion(MAESTRO_VERSION)
  expect(result.code).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual(['maestro', 'test', 'flow.yaml'])
})

test('version mismatch or failed version query prevents the test command', async () => {
  for (const [version, exitCode] of [
    ['2.6.0', 0],
    [MAESTRO_VERSION, 1],
  ] as const) {
    const result = await commandWithVersion(version, exitCode)
    expect(result.code).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(`Maestro ${MAESTRO_VERSION} required`)
    expect(result.stderr).toContain('bun run maestro:setup')
  }
})

test('missing Maestro gives the setup command before starting tests', async () => {
  const result = await commandWithVersion(null)
  expect(result.code).not.toBe(0)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('Maestro is missing. Run bun run maestro:setup.')
})
