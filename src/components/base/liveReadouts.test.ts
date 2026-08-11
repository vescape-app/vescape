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
  /**
   * Driving a non-editable `TextInput` through `animatedProps` used to be the way
   * to update text without re-rendering React. It routes every tick through the
   * shadow tree: Android chained `AndroidTextInputState` commits until the GC
   * thread stack overflowed, and iOS could blank the value when a text commit
   * raced the UI-thread prop write. `MonoValue` draws on Skia instead.
   */
  test('no animated TextInput is used to render live values', () => {
    const violations = listFiles(srcDir)
      .filter((file) =>
        /createAnimatedComponent\(\s*TextInput\s*\)/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(srcDir, file))
    expect(violations).toEqual([])
  })
})
