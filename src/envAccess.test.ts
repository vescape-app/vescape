import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const srcDir = join(import.meta.dir)

const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return listFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })

describe('env var access', () => {
  test('process.env is never indexed dynamically', () => {
    const offenders = listFiles(srcDir).filter((file) =>
      /process\.env\s*\[/.test(readFileSync(file, 'utf8')),
    )

    expect(offenders.map((file) => relative(srcDir, file))).toEqual([])
  })

  test('process.env is never destructured', () => {
    const offenders = listFiles(srcDir).filter((file) =>
      /(?:const|let|var)\s*\{[^}]*\}\s*=\s*process\.env/.test(readFileSync(file, 'utf8')),
    )

    expect(offenders.map((file) => relative(srcDir, file))).toEqual([])
  })
})
