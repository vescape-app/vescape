import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { preserveBundleLinks, spawnWithBun } from './ios-smoke-repack.ts'

const directories: string[] = []
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'ios-repack-'))
  directories.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test('repacking restores versioned framework links, including dangling links, without replacing conflicting files', () => {
  const directory = temporaryDirectory()
  const source = join(directory, 'source')
  const output = join(directory, 'output')
  for (const base of [source, output]) mkdirSync(join(base, 'Versions/A'), { recursive: true })
  symlinkSync('A', join(source, 'Versions/Current'))
  symlinkSync('Versions/Current/Framework', join(source, 'Framework'))
  preserveBundleLinks(source, output)
  preserveBundleLinks(source, output)
  expect(readlinkSync(join(output, 'Versions/Current'))).toBe('A')
  expect(readlinkSync(join(output, 'Framework'))).toBe('Versions/Current/Framework')
  rmSync(join(output, 'Framework'))
  writeFileSync(join(output, 'Framework'), 'unexpected replacement')
  expect(() => preserveBundleLinks(source, output)).toThrow()
})

test('Expo package commands execute through Bun with the supplied working directory and environment', async () => {
  const directory = temporaryDirectory()
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ scripts: { probe: 'bun probe.ts' } }),
  )
  writeFileSync(
    join(directory, 'probe.ts'),
    'process.stdout.write(process.env.REPACK_TEST_VALUE ?? "missing")',
  )
  const result = await spawnWithBun('npx', ['probe'], {
    cwd: directory,
    env: { ...process.env, REPACK_TEST_VALUE: 'bun-repack-process' },
  })
  expect(result.stdout).toBe('bun-repack-process')
  expect(result.status).toBe(0)
})
