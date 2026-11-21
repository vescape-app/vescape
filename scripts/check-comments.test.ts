import { describe, expect, test } from 'bun:test'
import { checkCommentsInSource, isExcludedPath } from './check-comments'

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

describe('check-comments: XML & exclusions', () => {
  test('flags authored XML comments including prose mentioning directives, while ignoring CDATA and attrs', () => {
    const xml = [
      '<resources>',
      '  <string name="a">foo <!-- ordinary xml comment --></string>',
      '  <!-- ordinary prose mentioning @parity or eslint-disable -->',
      '  <string name="b"><![CDATA[<!-- inside cdata -->]]></string>',
      '  <item attr="<!-- inside attr -->" />',
      '</resources>',
    ].join('\n')
    expect(
      checkCommentsInSource('watch/wearos/src/main/res/values/wear.xml', xml).map((v) => v.line),
    ).toEqual([2, 3])
  })

  test('scans plist and svg with the XML scanner', () => {
    const plist = ['<dict>', '  <!-- ordinary plist prose -->', '  <key>A</key>', '</dict>'].join(
      '\n',
    )
    expect(checkCommentsInSource('watch/watchos/Info.plist', plist).map((v) => v.line)).toEqual([2])
    expect(checkCommentsInSource('assets/logo.svg', '<svg><!-- x --></svg>')).toHaveLength(1)
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
