import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Expo inlines `process.env.EXPO_PUBLIC_*` at build time by matching the literal
 * member expression in source. Dynamic indexing or destructuring defeats that
 * substitution, so the value is `undefined` at runtime in a release build while
 * still working in dev — a failure that only surfaces after shipping.
 *
 * `eslint-plugin-expo` guarded this with `no-dynamic-env-var` and
 * `no-env-var-destructuring`; oxlint has no Expo plugin, so the contract lives
 * here instead. Unlike a lint rule, this cannot be silenced with an inline
 * comment.
 */
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
