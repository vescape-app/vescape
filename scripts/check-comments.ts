import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import ts from 'typescript'

export interface CommentToken {
  kind: 'line' | 'block' | 'xml'
  start: number
  end: number
  line: number
  text: string
}

export interface CommentViolation {
  file: string
  line: number
  snippet: string
}

const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const JS_ONLY_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs'])
const NATIVE_EXTENSIONS = new Set(['.swift', '.kt', '.kts', '.gradle'])
const XML_EXTENSIONS = new Set(['.xml', '.plist', '.svg'])

const EXCLUDED_EXACT_PATHS = new Set([
  'src/modules/release/generated/releaseNotes.ts',
  'modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/McconfLayouts.kt',
  'modules/vescape-core/ios/config/McconfLayouts.swift',
  'watch/watchos/PhosphorIcons.swift',
  'modules/vescape-core/android/src/main/assets/refloat-settings.xml',
])

const EXCLUDED_PATH_PATTERNS = [/^watch\/wearos\/src\/main\/res\/drawable\/ic_ph_[^/]+\.xml$/]

const PARAGRAPH_TAG_START =
  /^(?:@platform-diff(?:\s|$)|@legacy-float(?:\s|$)|TODO\((?:iOS|ios|Android|android|watchOS|Wear OS) parity\):\s*\S)/

const CODE_DIRECTIVE_LINE =
  /^(?:@parity(?:\s|$)|@platform-diff(?:\s|$)|intentional-suppression:\s*\S|@legacy-float(?:\s|$)|TODO\((?:iOS|ios|Android|android|watchOS|Wear OS) parity\):\s*\S|(?:eslint-(?:disable|enable)(?:-(?:next-)?line)?|oxlint-disable(?:-(?:next-)?line)?)(?:\s|$)|@ts-(?:expect-error|ignore|nocheck|check)(?:\s|$)|swiftlint:(?:disable|enable)(?::(?:next|this|previous))?(?:\s|$)|ktlint-(?:disable|enable)(?:\s|$)|(?:biome-ignore|prettier-ignore|fmt-ignore|knip-ignore|@knipignore|noinspection)(?:\s|:|$)|(?:istanbul|c8|v8)\s+ignore\b|swift-tools-version:\s*\d|<reference\s+(?:path|types|lib)=|@jsx(?:ImportSource)?\s|@refresh\s|[@#]\s*sourceMappingURL=|language=\w|@(?:vitest|jest)-environment\s)/

const XML_DIRECTIVE_LINE =
  /^(?:@parity(?:\s|$)|@platform-diff(?:\s|$)|intentional-suppression:\s*\S|@legacy-float(?:\s|$)|noinspection(?:\s|:|$))/

const JS_TYPE_ANNOTATION_LINE = /^@type(?:def)?\s*\{/

export function isExcludedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (EXCLUDED_EXACT_PATHS.has(normalized)) return true
  return EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isSupportedPath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return JS_EXTENSIONS.has(ext) || NATIVE_EXTENSIONS.has(ext) || XML_EXTENSIONS.has(ext)
}

function buildLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

function lineNumberAt(lineStarts: number[], offset: number): number {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lineStarts[mid] <= offset) lo = mid + 1
    else hi = mid - 1
  }
  return hi + 1
}

export function scanJsComments(filePath: string, text: string): CommentToken[] {
  const ext = extname(filePath).toLowerCase()
  const scriptKind =
    ext === '.tsx'
      ? ts.ScriptKind.TSX
      : ext === '.jsx'
        ? ts.ScriptKind.JSX
        : ext === '.ts'
          ? ts.ScriptKind.TS
          : ts.ScriptKind.JS
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind)
  const lineStarts = buildLineStarts(text)
  const jsxTextSpans: Array<[number, number]> = []
  const collectJsxSpans = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces) {
      jsxTextSpans.push([node.pos, node.end])
      return
    }
    ts.forEachChild(node, collectJsxSpans)
  }
  collectJsxSpans(sourceFile)

  const inJsxText = (pos: number) => jsxTextSpans.some(([start, end]) => pos >= start && pos < end)

  const seen = new Set<number>()
  const tokens: CommentToken[] = []

  const addRange = (range: ts.CommentRange) => {
    if (seen.has(range.pos) || inJsxText(range.pos)) return
    seen.add(range.pos)
    const raw = text.slice(range.pos, range.end)
    if (range.pos === 0 && raw.startsWith('#!')) return
    tokens.push({
      kind: range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? 'line' : 'block',
      start: range.pos,
      end: range.end,
      line: lineNumberAt(lineStarts, range.pos),
      text: raw,
    })
  }

  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces) {
      return
    }
    for (const r of ts.getLeadingCommentRanges(text, node.pos) ?? []) addRange(r)
    for (const r of ts.getTrailingCommentRanges(text, node.end) ?? []) addRange(r)
    for (const child of node.getChildren(sourceFile)) visit(child)
  }

  visit(sourceFile)
  tokens.sort((a, b) => a.start - b.start)
  return tokens
}

export function scanNativeComments(filePath: string, text: string): CommentToken[] {
  const ext = extname(filePath).toLowerCase()
  const isSwift = ext === '.swift'
  const isKotlin = ext === '.kt' || ext === '.kts'
  const isGradle = ext === '.gradle'
  const nestedBlock = isSwift || isKotlin
  const lineStarts = buildLineStarts(text)
  const tokens: CommentToken[] = []

  let i = 0
  const n = text.length

  if (text.startsWith('#!')) {
    const nl = text.indexOf('\n')
    i = nl < 0 ? n : nl + 1
  }

  const readLineComment = () => {
    const start = i
    const end = text.indexOf('\n', i)
    const stop = end < 0 ? n : end
    tokens.push({
      kind: 'line',
      start,
      end: stop,
      line: lineNumberAt(lineStarts, start),
      text: text.slice(start, stop),
    })
    i = stop
  }

  const readBlockComment = () => {
    const start = i
    let depth = 1
    i += 2
    while (i < n && depth > 0) {
      if (nestedBlock && text[i] === '/' && text[i + 1] === '*') {
        depth++
        i += 2
      } else if (text[i] === '*' && text[i + 1] === '/') {
        depth--
        i += 2
      } else {
        i++
      }
    }
    tokens.push({
      kind: 'block',
      start,
      end: i,
      line: lineNumberAt(lineStarts, start),
      text: text.slice(start, i),
    })
  }

  const scanDelimitedExpr = (openChar: string, closeChar: string) => {
    let depth = 1
    while (i < n && depth > 0) {
      const ch = text[i]
      if (ch === openChar) {
        depth++
        i++
      } else if (ch === closeChar) {
        depth--
        i++
      } else if (ch === '/' && text[i + 1] === '/') {
        readLineComment()
      } else if (ch === '/' && text[i + 1] === '*') {
        readBlockComment()
      } else if (trySkipStringOrRegex()) {
        continue
      } else {
        i++
      }
    }
  }

  const skipTripleDoubleQuoted = () => {
    i += 3
    while (i < n) {
      if (text[i] === '"' && text[i + 1] === '"' && text[i + 2] === '"') {
        i += 3
        return
      }
      if ((isKotlin || isGradle) && text[i] === '$' && text[i + 1] === '{') {
        i += 2
        scanDelimitedExpr('{', '}')
        continue
      }
      if (isSwift && text[i] === '\\' && text[i + 1] === '(') {
        i += 2
        scanDelimitedExpr('(', ')')
        continue
      }
      i++
    }
  }

  const skipDoubleQuoted = () => {
    i++
    while (i < n) {
      const ch = text[i]
      if (ch === '\\') {
        if (isSwift && text[i + 1] === '(') {
          i += 2
          scanDelimitedExpr('(', ')')
          continue
        }
        i += 2
        continue
      }
      if ((isKotlin || isGradle) && ch === '$' && text[i + 1] === '{') {
        i += 2
        scanDelimitedExpr('{', '}')
        continue
      }
      if (ch === '"') {
        i++
        return
      }
      if (ch === '\n') return
      i++
    }
  }

  const trySkipStringOrRegex = (): boolean => {
    const ch = text[i]

    if (isSwift && ch === '#') {
      let hashes = 0
      while (text[i + hashes] === '#') hashes++
      if (text[i + hashes] === '/') {
        const term = '/' + '#'.repeat(hashes)
        const end = text.indexOf(term, i + hashes + 1)
        i = end < 0 ? n : end + term.length
        return true
      }
      if (text.startsWith('"""', i + hashes)) {
        const term = '"""' + '#'.repeat(hashes)
        const end = text.indexOf(term, i + hashes + 3)
        i = end < 0 ? n : end + term.length
        return true
      }
      if (text[i + hashes] === '"') {
        const term = '"' + '#'.repeat(hashes)
        const end = text.indexOf(term, i + hashes + 1)
        i = end < 0 ? n : end + term.length
        return true
      }
    }

    if (ch === '"' && text[i + 1] === '"' && text[i + 2] === '"') {
      skipTripleDoubleQuoted()
      return true
    }

    if (ch === '"') {
      skipDoubleQuoted()
      return true
    }

    if (isGradle && ch === "'" && text[i + 1] === "'" && text[i + 2] === "'") {
      const end = text.indexOf("'''", i + 3)
      i = end < 0 ? n : end + 3
      return true
    }

    if (ch === "'" && !isSwift) {
      i++
      while (i < n) {
        if (text[i] === '\\') i += 2
        else if (text[i] === "'") {
          i++
          break
        } else if (text[i] === '\n') break
        else i++
      }
      return true
    }

    return false
  }

  while (i < n) {
    if (text[i] === '/' && text[i + 1] === '/') {
      readLineComment()
      continue
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      readBlockComment()
      continue
    }
    if (trySkipStringOrRegex()) {
      continue
    }
    i++
  }

  return tokens
}

export function scanXmlComments(text: string): CommentToken[] {
  const lineStarts = buildLineStarts(text)
  const tokens: CommentToken[] = []
  let i = 0
  const n = text.length

  while (i < n) {
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9)
      i = end < 0 ? n : end + 3
      continue
    }
    if (text.startsWith('<!--', i)) {
      const start = i
      const end = text.indexOf('-->', i + 4)
      const stop = end < 0 ? n : end + 3
      tokens.push({
        kind: 'xml',
        start,
        end: stop,
        line: lineNumberAt(lineStarts, start),
        text: text.slice(start, stop),
      })
      i = stop
      continue
    }
    if (text[i] === '<') {
      i++
      while (i < n && text[i] !== '>') {
        if (text[i] === '"' || text[i] === "'") {
          const q = text[i++]
          while (i < n && text[i] !== q) i++
          if (i < n) i++
        } else {
          i++
        }
      }
      if (i < n) i++
      continue
    }
    i++
  }

  return tokens
}

function stripCommentSyntax(line: string, kind: CommentToken['kind']): string {
  let s = line.trim()
  if (kind === 'line') {
    s = s.replace(/^\/\/\/?/, '').trim()
  } else if (kind === 'block') {
    s = s
      .replace(/^\/\*\*?/, '')
      .replace(/\*\/$/, '')
      .trim()
    s = s.replace(/^\*/, '').trim()
  } else {
    s = s.replace(/^<!--/, '').replace(/-->$/, '').trim()
  }
  return s
}

function isAllowedCommentLine(
  cleaned: string,
  kind: CommentToken['kind'],
  allowJsTypeAnnotation: boolean,
  inPlatformDiffParagraph: boolean,
): { allowed: boolean; nextInPlatformDiff: boolean } {
  if (cleaned === '') {
    return { allowed: true, nextInPlatformDiff: false }
  }
  const directivePattern = kind === 'xml' ? XML_DIRECTIVE_LINE : CODE_DIRECTIVE_LINE
  if (directivePattern.test(cleaned)) {
    return { allowed: true, nextInPlatformDiff: PARAGRAPH_TAG_START.test(cleaned) }
  }
  if (allowJsTypeAnnotation && kind !== 'xml' && JS_TYPE_ANNOTATION_LINE.test(cleaned)) {
    return { allowed: true, nextInPlatformDiff: false }
  }
  if (inPlatformDiffParagraph && !cleaned.startsWith('@')) {
    return { allowed: true, nextInPlatformDiff: true }
  }
  return { allowed: false, nextInPlatformDiff: false }
}

export function checkCommentsInSource(filePath: string, text: string): CommentViolation[] {
  if (isExcludedPath(filePath) || !isSupportedPath(filePath)) return []
  const ext = extname(filePath).toLowerCase()
  const allowJsTypeAnnotation = JS_ONLY_EXTENSIONS.has(ext)

  const tokens = JS_EXTENSIONS.has(ext)
    ? scanJsComments(filePath, text)
    : NATIVE_EXTENSIONS.has(ext)
      ? scanNativeComments(filePath, text)
      : scanXmlComments(text)

  const violations: CommentViolation[] = []

  let prevLineEndLine = -2
  let inLinePlatformDiff = false

  for (const token of tokens) {
    if (token.kind === 'line') {
      const contiguous = token.line === prevLineEndLine + 1
      if (!contiguous) inLinePlatformDiff = false
      const cleaned = stripCommentSyntax(token.text, 'line')
      const { allowed, nextInPlatformDiff } = isAllowedCommentLine(
        cleaned,
        'line',
        allowJsTypeAnnotation,
        inLinePlatformDiff,
      )
      inLinePlatformDiff = nextInPlatformDiff
      prevLineEndLine = token.line
      if (!allowed) {
        violations.push({
          file: filePath,
          line: token.line,
          snippet: token.text.trim().slice(0, 100),
        })
      }
      continue
    }

    inLinePlatformDiff = false
    prevLineEndLine = -2

    const lines = token.text.split('\n')
    let inBlockPlatformDiff = false
    let firstDisallowedLine: { line: number; raw: string } | null = null

    for (let idx = 0; idx < lines.length; idx++) {
      const cleaned = stripCommentSyntax(lines[idx], token.kind)
      const { allowed, nextInPlatformDiff } = isAllowedCommentLine(
        cleaned,
        token.kind,
        allowJsTypeAnnotation,
        inBlockPlatformDiff,
      )
      inBlockPlatformDiff = nextInPlatformDiff
      if (!allowed && firstDisallowedLine === null) {
        firstDisallowedLine = { line: token.line + idx, raw: lines[idx].trim() }
      }
    }

    if (firstDisallowedLine !== null) {
      violations.push({
        file: filePath,
        line: firstDisallowedLine.line,
        snippet: firstDisallowedLine.raw.slice(0, 100),
      })
    }
  }

  return violations
}

export function trackedRepoFiles(cwd = process.cwd()): string[] {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' })
  return output
    .split('\0')
    .filter((line) => line.length > 0 && isSupportedPath(line) && !isExcludedPath(line))
}

export function runStagedCommentLint(cwd = process.cwd()): CommentViolation[] {
  const output = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'],
    { cwd, encoding: 'utf8' },
  )
  const files = output
    .split('\0')
    .filter((file) => file.length > 0 && isSupportedPath(file) && !isExcludedPath(file))

  const violations: CommentViolation[] = []
  for (const file of files) {
    const abs = resolve(cwd, file)
    if (existsSync(abs) && lstatSync(abs).isSymbolicLink()) continue
    const text = execFileSync('git', ['show', `:${file}`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    violations.push(...checkCommentsInSource(file, text))
  }
  return violations
}

export function runCommentLint(fileArgs: string[], cwd = process.cwd()): CommentViolation[] {
  if (fileArgs.includes('--staged')) {
    return runStagedCommentLint(cwd)
  }
  const files =
    fileArgs.length > 0
      ? fileArgs.filter((f) => isSupportedPath(f) && !isExcludedPath(f))
      : trackedRepoFiles(cwd)

  const violations: CommentViolation[] = []
  for (const file of files) {
    const abs = resolve(cwd, file)
    if (!existsSync(abs) || lstatSync(abs).isSymbolicLink()) continue
    const text = readFileSync(abs, 'utf8')
    violations.push(...checkCommentsInSource(file, text))
  }
  return violations
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const violations = runCommentLint(args)
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`${v.file}:${v.line}: disallowed comment: ${v.snippet}`)
    }
    console.error(
      `\nFound ${violations.length} disallowed comment(s). Only contract metadata (@parity, @platform-diff, intentional-suppression:, @legacy-float) and compiler/linter directives are permitted; document architectural decisions in docs/adr/.`,
    )
    process.exit(1)
  }
}
