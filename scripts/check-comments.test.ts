import { describe, expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyCommentBaseline,
  checkCommentsInSource,
  isExcludedPath,
  runStagedCommentLint,
} from './check-comments'

test('ratchets exact comments by file and multiplicity across line shifts', () => {
  const file = 'src/demo.ts'
  const legacy = '// grandfathered comment'
  const key = `${file}:${createHash('sha256').update(legacy).digest('hex')}`
  const baseline = { [key]: 1 }
  const shifted = checkCommentsInSource(
    file,
    `export const value = 1\n${legacy}\n${legacy}\n// new prose`,
  )
  const moved = checkCommentsInSource('src/other.ts', legacy)
  const result = applyCommentBaseline([...shifted, ...moved], baseline)

  expect(result.newViolations.map(({ file, line }) => `${file}:${line}`)).toEqual([
    `${file}:3`,
    `${file}:4`,
    'src/other.ts:1',
  ])
  expect(result.remaining).toEqual({})
  expect(applyCommentBaseline([], baseline).remaining).toEqual(baseline)
})

test('lists grandfathered comments and checks baseline pruning within the selected scope', () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'comment-lint-baseline-')))
  try {
    const lint = (...args: string[]) =>
      spawnSync(process.execPath, [join(import.meta.dir, 'check-comments.ts'), ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, COMMENT_BASELINE_REF: '' },
      })
    execFileSync('git', ['init', '-q'], { cwd })
    mkdirSync(join(cwd, 'scripts'))
    const file = join(cwd, 'legacy.ts')
    writeFileSync(file, '// legacy prose\nexport const value = 1\n')
    writeFileSync(join(cwd, 'clean.ts'), 'export const clean = 1\n')
    const inventory = lint('--inventory', file)
    expect(inventory.status).toBe(0)
    writeFileSync(join(cwd, 'scripts/comment-baseline.json'), inventory.stdout)
    expect(lint(file).status).toBe(0)
    expect(lint('--list', file).stdout).toContain('legacy.ts:1: // legacy prose')

    writeFileSync(file, 'export const value = 1\n')
    expect(lint('clean.ts').status).toBe(0)
    expect(lint(file).stderr).toContain('for legacy.ts')
    execFileSync('git', ['add', '.'], { cwd })
    const staged = lint('--staged')
    expect(staged.status).toBe(1)
    expect(staged.stderr).toContain('for legacy.ts')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

describe('check-comments: TS/TSX/JS', () => {
  test('flags ordinary single-line, block, JSDoc, TODO, and JSX comments', () => {
    const src = [
      '// ordinary explanation',
      'const a = 1',
      '/** JSDoc prose */',
      'export function f() {',
      '  /* TODO: fix later */',
      '  return a',
      '}',
    ].join('\n')
    expect(checkCommentsInSource('src/demo.ts', src).map((v) => v.line)).toEqual([1, 3, 5])
  })

  test('ignores JSX text looking like comments while still flagging real JSX comments', () => {
    const src = [
      'export function View() {',
      '  const a = <p>// JSX text</p>',
      '  const b = <p>/* JSX text */</p>',
      '  const url = "https://example.com//not-a-comment"',
      '  return <div>{a}{b}{/* ordinary jsx comment */}{url}</div>',
      '}',
    ].join('\n')
    expect(checkCommentsInSource('src/View.tsx', src).map((v) => v.line)).toEqual([5])
  })

  test('ignores comment-like tokens inside strings, template literals, and regexes', () => {
    const src = [
      'const url = "https://api.vescape.app/v1/*not-block*/"',
      'const tpl = `prefix // not comment ${1 + 2} /* also not */`',
      'const rx = /\\/\\/.*$/g',
      'const rx2 = /foo\\/bar\\/*baz/i',
      'export const ok = url + tpl + String(rx) + String(rx2)',
    ].join('\n')
    expect(checkCommentsInSource('src/strings.ts', src)).toEqual([])
  })

  test('allows anchored contract metadata and compiler/linter directives', () => {
    const src = [
      '#!/usr/bin/env bun',
      '// @parity /modules/vescape-core/ios/Foo.swift',
      '// @platform-diff iOS uses CoreBluetooth while Android',
      '// uses GATT directly for this bridge contract.',
      '// intentional-suppression: teardown best effort',
      '// @legacy-float info-v1: remove when v1 ends',
      '// Removal checklist: /docs/legacy-float.md#info-v1',
      '// TODO(iOS parity): port live duty exclusion flag',
      '// wraps to a second line cleanly.',
      '// eslint-disable-next-line no-console',
      '// oxlint-disable-next-line no-explicit-any',
      '// @ts-expect-error testing invalid input',
      'export const x = 1',
    ].join('\n')
    expect(checkCommentsInSource('src/allowed.ts', src)).toEqual([])
  })

  test('rejects empty comments, bare contract tags, and trailing-comment continuation leaks', () => {
    const src = [
      '//',
      '/* */',
      '// @parity',
      '// @parity not a repo path',
      '// @platform-diff',
      '// @legacy-float',
      'const a = 1 // @platform-diff inline reason',
      '// sneaky prose must not inherit continuation from trailing comment',
      'export const x = a',
    ].join('\n')
    expect(checkCommentsInSource('src/bypasses.ts', src).map((v) => v.line)).toEqual([
      1, 2, 3, 4, 5, 6, 8,
    ])
  })

  test('rejects ordinary prose that merely mentions a directive or bun: mid-comment', () => {
    const src = [
      '// TODO: switch to bun:sqlite',
      '// a discussion mentioning @parity',
      '// why we dislike eslint-disable here',
      '// intentional-suppression:',
      'export const x = 1',
    ].join('\n')
    expect(checkCommentsInSource('src/unanchored.ts', src).map((v) => v.line)).toEqual([1, 2, 3, 4])
  })

  test('rejects prose mixed into a @parity block unless it is a @platform-diff continuation', () => {
    const src = [
      '/**',
      ' * Ordinary prose above parity.',
      ' * @parity /modules/vescape-core/ios/Foo.swift',
      ' */',
      'export const x = 1',
    ].join('\n')
    expect(checkCommentsInSource('src/mixed.ts', src).map((v) => v.line)).toEqual([2])
  })

  test('allows JSDoc @type in .js files but rejects it in .ts files', () => {
    const js = "/** @type {import('@bacons/apple-targets').Config} */\nmodule.exports = {}"
    expect(checkCommentsInSource('targets/watch-battery/expo-target.config.js', js)).toEqual([])
    expect(checkCommentsInSource('src/typed.ts', js).map((v) => v.line)).toEqual([1])
  })
})

describe('check-comments: Kotlin, Swift & Gradle', () => {
  test('handles Kotlin nested comments, raw strings, and string interpolation', () => {
    const kt = [
      'val url = "https://vescape.app//ok"',
      'val nestedStr = "${"https://x//comment-like"}"',
      'val realInInterp = "${1 /* real */}"',
      'val raw = """',
      '  // inside raw string',
      '  /* also inside raw string */',
      '"""',
      "val ch = '/'",
      '/* outer /* nested */ comment */',
      '// ordinary kotlin comment',
      'val x = 1',
    ].join('\n')
    expect(
      checkCommentsInSource('modules/vescape-core/android/Foo.kt', kt).map((v) => v.line),
    ).toEqual([3, 9, 10])
  })

  test('preserves multi-line @platform-diff and @parity in Kotlin KDoc', () => {
    const kt = [
      '/**',
      ' * @parity /modules/vescape-core/ios/Foo.swift',
      ' * @platform-diff Android defers GPS arming to the foreground service;',
      ' * iOS has no serviceless window.',
      ' */',
      'class Foo',
    ].join('\n')
    expect(checkCommentsInSource('modules/vescape-core/android/Foo.kt', kt)).toEqual([])
  })

  test('handles Swift raw strings, extended regexes, interpolation comments, and rejects MARK/prose', () => {
    const swift = [
      '// swift-tools-version: 5.9',
      'let raw = #"// not a comment /* nope */"#',
      'let multi = #"""',
      '// still not a comment',
      '"""#',
      'let rx = #/ https://a /#',
      'let interpStr = "prefix \\("https://a//b") suffix"',
      'let interpComment = "\\(1 /* real */)"',
      '// MARK: - Helpers',
      '/// Ordinary doc comment',
      'let x = 1',
    ].join('\n')
    expect(
      checkCommentsInSource('modules/vescape-core/Package.swift', swift).map((v) => v.line),
    ).toEqual([8, 9, 10])
  })

  test('handles Groovy triple-single-quoted strings in .gradle files', () => {
    const gradle = ["def url = '''", '// not a comment', "'''", '// real gradle comment'].join('\n')
    expect(checkCommentsInSource('watch/wearos/build.gradle', gradle).map((v) => v.line)).toEqual([
      4,
    ])
  })
})

describe('check-comments: XML, hash scripts & exclusions', () => {
  test('flags authored XML comments including empty and directive-mentioning prose, while ignoring CDATA and attrs', () => {
    const xml = [
      '<resources>',
      '  <string name="a">foo <!-- ordinary xml comment --></string>',
      '  <!-- ordinary prose mentioning @parity or eslint-disable -->',
      '  <!-- -->',
      '  <string name="b"><![CDATA[<!-- inside cdata -->]]></string>',
      '  <item attr="<!-- inside attr -->" />',
      '</resources>',
    ].join('\n')
    expect(
      checkCommentsInSource('watch/wearos/src/main/res/values/wear.xml', xml).map((v) => v.line),
    ).toEqual([2, 3, 4])
  })

  test('scans plist and svg with the XML scanner', () => {
    expect(
      checkCommentsInSource(
        'targets/ride-activity/Info.plist',
        '<plist><!-- prose --></plist>',
      ).map((v) => v.line),
    ).toEqual([1])
    expect(
      checkCommentsInSource('assets/logo/vescape-sygnet.svg', '<svg><!-- prose --></svg>').map(
        (v) => v.line,
      ),
    ).toEqual([1])
  })

  test('scans Python via stdlib tokenize and Ruby/podspec via Ripper without regex or string FPs', () => {
    const rb = [
      '# Copyright (c) Meta Platforms, Inc. and affiliates.',
      '#',
      '# This source code is licensed under the MIT license.',
      'name = "Pod#{i}"',
      'rx = /literal#hash/',
      '# ordinary ruby comment',
    ].join('\n')
    expect(checkCommentsInSource('scripts/test-ios-spm-uuids.rb', rb).map((v) => v.line)).toEqual([
      6,
    ])

    const py = [
      '#!/usr/bin/env python3',
      's = """# inside triple string"""',
      't = f"{mapping[\'#\']}"',
      '# ordinary python comment',
    ].join('\n')
    expect(checkCommentsInSource('scripts/alert-packs/kokoro.py', py).map((v) => v.line)).toEqual([
      4,
    ])
  })

  test('scans YAML via real CST parser while preserving block scalars and quoted strings', () => {
    const yml = [
      '# top comment',
      'name: CI',
      'run: |',
      '  # comment inside literal block scalar',
      '  echo "ok"',
      'folded: >',
      '  # text inside folded scalar',
      'quoted: "# not a comment"',
      'plain: foo#bar',
      'key: value # inline comment',
    ].join('\n')
    expect(checkCommentsInSource('.github/workflows/ci.yml', yml).map((v) => v.line)).toEqual([
      1, 10,
    ])
  })

  test('excludes generated and third-party files by explicit provenance only', () => {
    expect(isExcludedPath('src/modules/release/generated/releaseNotes.ts')).toBe(true)
    expect(
      isExcludedPath(
        'modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/McconfLayouts.kt',
      ),
    ).toBe(true)
    expect(isExcludedPath('watch/wearos/src/main/res/drawable/ic_ph_sun.xml')).toBe(true)
    expect(isExcludedPath('watch/wearos/src/main/res/values/wear.xml')).toBe(false)
    expect(isExcludedPath('src/app/_layout.tsx')).toBe(false)
  })
})

describe('check-comments: --staged uses git index mode and bytes', () => {
  test('flags a staged regular file even if replaced by a symlink in the worktree, and skips staged symlinks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'comment-lint-staged-'))
    try {
      const git = (args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
      git(['init'])
      writeFileSync(join(dir, 'target.ts'), 'export const ok = 1\n')
      writeFileSync(join(dir, 'test.ts'), '// ordinary staged comment\nexport const x = 1\n')
      git(['add', 'target.ts', 'test.ts'])
      unlinkSync(join(dir, 'test.ts'))
      symlinkSync('target.ts', join(dir, 'test.ts'))

      symlinkSync('target.ts', join(dir, 'linked.ts'))
      git(['add', 'linked.ts'])

      const violations = runStagedCommentLint(dir)
      expect(violations.map((v) => `${v.file}:${v.line}`)).toEqual(['test.ts:1'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('flags a typechange (T) replacing a committed symlink with a staged regular file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'comment-lint-typechange-'))
    try {
      const git = (args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
      git(['init'])
      git(['config', 'user.email', 'test@example.com'])
      git(['config', 'user.name', 'Test'])
      writeFileSync(join(dir, 'target.ts'), 'export const ok = 1\n')
      symlinkSync('target.ts', join(dir, 'replaced.ts'))
      git(['add', 'target.ts', 'replaced.ts'])
      git(['commit', '-m', 'init'])

      unlinkSync(join(dir, 'replaced.ts'))
      writeFileSync(join(dir, 'replaced.ts'), '// typechange comment\nexport const x = 1\n')
      git(['add', 'replaced.ts'])

      const violations = runStagedCommentLint(dir)
      expect(violations.map((v) => `${v.file}:${v.line}`)).toEqual(['replaced.ts:1'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
