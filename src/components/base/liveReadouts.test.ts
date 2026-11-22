import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const srcDir = join(import.meta.dir, '..', '..')

const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return listFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })

describe('live readouts', () => {
  test('no animated TextInput is used to render live values', () => {
    const violations = listFiles(srcDir)
      .filter((file) =>
        /createAnimatedComponent\(\s*TextInput\s*\)/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(srcDir, file))
    expect(violations).toEqual([])
  })
})
