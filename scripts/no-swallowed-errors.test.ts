import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import ts from 'typescript'

const MARKER = /intentional-suppression:\s*\S.*/
const JS_ROOTS = ['src', 'modules', 'scripts', 'plugins']
const NATIVE_ROOTS = [
  'modules/vescape-core/ios',
  'modules/vescape-core/android/src/main',
  'watch/wearos/src/main',
]

function sourceFiles(path: string, extensions: Set<string>): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      if (
        entry.name.startsWith('.') ||
        ['node_modules', 'generated', '__tests__', 'test', 'tests'].includes(entry.name)
      )
        return []
      return sourceFiles(child, extensions)
    }
    if (
      !extensions.has(extname(entry.name)) ||
      /(?:Tests?|Spec)\.[^.]+$|\.(test|spec)\.[^.]+$/.test(entry.name)
    )
      return []
    return [child]
  })
}

function lineAt(text: string, position: number): number {
  return text.slice(0, position).split('\n').length
}

function hasNearbyMarker(markerLines: Set<number>, line: number): boolean {
  return [line, line - 1, line - 2, line - 3, line - 4].some((candidate) =>
    markerLines.has(candidate),
  )
}

function tsMarkerLines(text: string, source: ts.SourceFile): Set<number> {
  const lines = new Set<number>()
  const collect = (position: number, trailing: boolean) => {
    const ranges = trailing
      ? ts.getTrailingCommentRanges(text, position)
      : ts.getLeadingCommentRanges(text, position)
    for (const range of ranges ?? [])
      if (MARKER.test(text.slice(range.pos, range.end))) lines.add(lineAt(text, range.pos))
  }
  const visit = (node: ts.Node) => {
    collect(node.pos, false)
    collect(node.end, true)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return lines
}

function noopCatchViolations(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const markers = tsMarkerLines(text, source)
  const violations: string[] = []
  const noop = (body: ts.ConciseBody): boolean => {
    if (ts.isBlock(body)) {
      if (body.statements.length === 0) return true
      if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0])) return false
      return body.statements[0].expression == null || noop(body.statements[0].expression)
    }
    return (
      (ts.isIdentifier(body) && body.text === 'undefined') ||
      body.kind === ts.SyntaxKind.NullKeyword ||
      body.kind === ts.SyntaxKind.FalseKeyword ||
      (ts.isArrayLiteralExpression(body) && body.elements.length === 0) ||
      (ts.isVoidExpression(body) &&
        ts.isNumericLiteral(body.expression) &&
        body.expression.text === '0')
    )
  }
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'catch'
    ) {
      const callback = node.arguments[0]
      const line = lineAt(text, node.getStart(source))
      if (
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        noop(callback.body) &&
        !hasNearbyMarker(markers, line)
      )
        violations.push(`${path}:${line}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return violations
}

/** Masks native comments and string literals while retaining offsets and real marker comments. */
function lexNative(text: string): { code: string; markers: Set<number> } {
  const chars = [...text]
  const markers = new Set<number>()
  const mask = (start: number, end: number) => {
    for (let index = start; index < end; index++) if (chars[index] !== '\n') chars[index] = ' '
  }
  let index = 0
  while (index < text.length) {
    if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index)
      const stop = end < 0 ? text.length : end
      if (MARKER.test(text.slice(index, stop))) markers.add(lineAt(text, index))
      mask(index, stop)
      index = stop
      continue
    }
    if (text.startsWith('/*', index)) {
      const start = index
      let depth = 1
      index += 2
      while (index < text.length && depth > 0) {
        if (text.startsWith('/*', index)) {
          depth++
          index += 2
        } else if (text.startsWith('*/', index)) {
          depth--
          index += 2
        } else index++
      }
      mask(start, index)
      continue
    }
    if (text.startsWith('"""', index)) {
      const start = index
      const end = text.indexOf('"""', index + 3)
      index = end < 0 ? text.length : end + 3
      mask(start, index)
      continue
    }
    const raw = text.slice(index).match(/^#+"/)
    if (raw) {
      const start = index
      const hashes = raw[0].length - 1
      const terminator = '"' + '#'.repeat(hashes)
      const end = text.indexOf(terminator, index + raw[0].length)
      index = end < 0 ? text.length : end + terminator.length
      mask(start, index)
      continue
    }
    if (text[index] === '"' || text[index] === "'") {
      const start = index
      const quote = text[index++]
      while (index < text.length) {
        if (text[index] === '\\') index += 2
        else if (text[index++] === quote) break
      }
      mask(start, index)
      continue
    }
    index++
  }
  return { code: chars.join(''), markers }
}

function nativeViolations(path: string, text: string): string[] {
  const { code, markers } = lexNative(text)
  const patterns =
    extname(path) === '.swift'
      ? [/\btry\?/g, /\bcatch\s*(?:\([^)]*\)\s*)?\{\s*\}/g]
      : [/\brunCatching\s*\{/g, /\bcatch\s*\([^)]*\)\s*\{\s*\}/g]
  return patterns
    .flatMap((pattern) => [...code.matchAll(pattern)])
    .filter((match) => !hasNearbyMarker(markers, lineAt(text, match.index!)))
    .map((match) => `${path}:${lineAt(text, match.index!)}`)
}

test('production failure suppressions require an explicit owner or reason', () => {
  const js = JS_ROOTS.flatMap((root) =>
    sourceFiles(root, new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])),
  )
  const native = NATIVE_ROOTS.flatMap((root) => sourceFiles(root, new Set(['.swift', '.kt'])))
  expect([
    ...js.flatMap((path) => noopCatchViolations(path, readFileSync(path, 'utf8'))),
    ...native.flatMap((path) => nativeViolations(path, readFileSync(path, 'utf8'))),
  ]).toEqual([])
})

test('suppression scanner accepts only nearby markers in real comments', () => {
  expect(
    nativeViolations('Sample.swift', 'let text = "// intentional-suppression: fake"\ntry? work()'),
  ).toEqual(['Sample.swift:2'])
  expect(
    nativeViolations(
      'Sample.swift',
      'let text = """\n// intentional-suppression: fake\n"""\ntry? work()',
    ),
  ).toEqual(['Sample.swift:4'])
  expect(
    nativeViolations(
      'Sample.swift',
      'let text = #"// intentional-suppression: fake"#\ntry? work()',
    ),
  ).toEqual(['Sample.swift:2'])
  expect(
    nativeViolations(
      'Sample.kt',
      '/* outer /* intentional-suppression: fake */ end */\nrunCatching { work() }',
    ),
  ).toEqual(['Sample.kt:2'])
  expect(
    nativeViolations(
      'Sample.kt',
      '// intentional-suppression: teardown is best effort\nrunCatching { stop() }',
    ),
  ).toEqual([])
  expect(noopCatchViolations('sample.ts', 'promise.catch(() => { return undefined })')).toEqual([
    'sample.ts:1',
  ])
  expect(
    noopCatchViolations(
      'sample.ts',
      'const fake = "// intentional-suppression: nope"\npromise.catch(() => null)',
    ),
  ).toEqual(['sample.ts:2'])
  expect(
    noopCatchViolations(
      'sample.ts',
      '// intentional-suppression: modal owns the error\npromise.catch(() => [])',
    ),
  ).toEqual([])
})
