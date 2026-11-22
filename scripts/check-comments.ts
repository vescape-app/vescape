import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import ts from 'typescript'

export interface CommentToken {
  kind: 'line' | 'block' | 'hash'
  start: number
  end: number
  line: number
  text: string
  wholeLine: boolean
}

export interface CommentViolation {
  file: string
  line: number
  snippet: string
}

const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const JS_ONLY_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs'])
const NATIVE_EXTENSIONS = new Set(['.swift', '.kt', '.kts', '.gradle'])
const PYTHON_EXTENSIONS = new Set(['.py'])
const RUBY_EXTENSIONS = new Set(['.rb'])

const EXCLUDED_EXACT_PATHS = new Set([
  'src/modules/release/generated/releaseNotes.ts',
  'modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/McconfLayouts.kt',
  'modules/vescape-core/ios/config/McconfLayouts.swift',
  'watch/watchos/PhosphorIcons.swift',
])

const PARAGRAPH_TAG_START =
  /^(?:@platform-diff\s+\S|@legacy-float\s+\S|TODO\((?:iOS|ios|Android|android|watchOS|Wear OS) parity\):\s*\S)/

const CODE_DIRECTIVE_LINE =
  /^(?:@parity\s+\/\S|@platform-diff\s+\S|intentional-suppression:\s*\S|@legacy-float\s+\S|TODO\((?:iOS|ios|Android|android|watchOS|Wear OS) parity\):\s*\S|(?:eslint-(?:disable|enable)(?:-(?:next-)?line)?|oxlint-disable(?:-(?:next-)?line)?)(?:\s|$)|@ts-(?:expect-error|ignore|nocheck|check)(?:\s|$)|swiftlint:(?:disable|enable)(?::(?:next|this|previous))?(?:\s|$)|ktlint-(?:disable|enable)(?:\s|$)|(?:biome-ignore|prettier-ignore|fmt-ignore|knip-ignore|@knipignore|noinspection)(?:\s|:|$)|(?:istanbul|c8|v8)\s+ignore\b|swift-tools-version:\s*\d|<reference\s+(?:path|types|lib)=|@jsx(?:ImportSource)?\s|@refresh\s|[@#]\s*sourceMappingURL=|language=\w|@(?:vitest|jest)-environment\s)/

const HASH_DIRECTIVE_LINE =
  /^(?:@parity\s+\/\S|@platform-diff\s+\S|intentional-suppression:\s*\S|@legacy-float\s+\S|frozen_string_literal:\s*(?:true|false)|(?:-\*-\s*)?coding[:=]\s*[-\w.]+|rubocop:(?:disable|enable)|type:\s*ignore|noqa\b|SPDX-License-Identifier:\s*\S|Copyright\s+(?:\(c\)|©)\s+\S)/i

const JS_TYPE_ANNOTATION_LINE = /^@type(?:def)?\s*\{/

const PYTHON_TOKENIZER_SCRIPT = [
  'import io, json, sys, tokenize',
  'src = sys.stdin.read()',
  'out = []',
  'for tok in tokenize.generate_tokens(io.StringIO(src).readline):',
  '    if tok.type == tokenize.COMMENT:',
  '        out.append([tok.start[0], tok.start[1], tok.string])',
  'print(json.dumps(out))',
].join('\n')

const RUBY_RIPPER_SCRIPT = [
  'require "ripper"',
  'require "json"',
  'src = STDIN.read',
  'out = []',
  'Ripper.lex(src).each do |pos, type, tok, _|',
  '  out << [pos[0], pos[1], tok.chomp] if type == :on_comment',
  'end',
  'puts JSON.generate(out)',
].join('\n')

export function isExcludedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  return EXCLUDED_EXACT_PATHS.has(normalized)
}

export function isSupportedPath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return (
    JS_EXTENSIONS.has(ext) ||
    NATIVE_EXTENSIONS.has(ext) ||
    PYTHON_EXTENSIONS.has(ext) ||
    RUBY_EXTENSIONS.has(ext)
  )
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

function isWholeLineComment(
  text: string,
  lineStarts: number[],
  line: number,
  start: number,
): boolean {
  const lineStart = lineStarts[line - 1]
  for (let i = lineStart; i < start; i++) {
    const ch = text[i]
    if (ch !== ' ' && ch !== '\t') return false
  }
  return true
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
    const line = lineNumberAt(lineStarts, range.pos)
    tokens.push({
      kind: range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? 'line' : 'block',
      start: range.pos,
      end: range.end,
      line,
      text: raw,
      wholeLine: isWholeLineComment(text, lineStarts, line, range.pos),
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
    const line = lineNumberAt(lineStarts, start)
    tokens.push({
      kind: 'line',
      start,
      end: stop,
      line,
      text: text.slice(start, stop),
      wholeLine: isWholeLineComment(text, lineStarts, line, start),
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
    const line = lineNumberAt(lineStarts, start)
    tokens.push({
      kind: 'block',
      start,
      end: i,
      line,
      text: text.slice(start, i),
      wholeLine: isWholeLineComment(text, lineStarts, line, start),
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

function tokensFromExternalLexer(
  text: string,
  entries: Array<[number, number, string]>,
): CommentToken[] {
  const lineStarts = buildLineStarts(text)
  const tokens: CommentToken[] = []
  for (const [line, col, raw] of entries) {
    if (line === 1 && col === 0 && raw.startsWith('#!')) continue
    const start = (lineStarts[line - 1] ?? 0) + col
    tokens.push({
      kind: 'hash',
      start,
      end: start + raw.length,
      line,
      text: raw,
      wholeLine: isWholeLineComment(text, lineStarts, line, start),
    })
  }
  return tokens
}

export function scanPythonComments(text: string): CommentToken[] {
  const stdout = execFileSync('python3', ['-c', PYTHON_TOKENIZER_SCRIPT], {
    input: text,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const entries = JSON.parse(stdout) as Array<[number, number, string]>
  return tokensFromExternalLexer(text, entries)
}

export function scanRubyComments(text: string): CommentToken[] {
  const stdout = execFileSync('ruby', ['-e', RUBY_RIPPER_SCRIPT], {
    input: text,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const entries = JSON.parse(stdout) as Array<[number, number, string]>
  return tokensFromExternalLexer(text, entries)
}

function stripCommentSyntax(line: string, kind: CommentToken['kind']): string {
  let s = line.trim()
  if (kind === 'line') {
    s = s.replace(/^\/\/\/?/, '').trim()
  } else if (kind === 'hash') {
    s = s.replace(/^#/, '').trim()
  } else {
    s = s
      .replace(/^\/\*\*?/, '')
      .replace(/\*\/$/, '')
      .trim()
    s = s.replace(/^\*/, '').trim()
  }
  return s
}

function isAllowedCommentLine(
  cleaned: string,
  kind: CommentToken['kind'],
  allowJsTypeAnnotation: boolean,
  inContinuation: boolean,
  allowEmpty: boolean,
): { allowed: boolean; nextInContinuation: boolean; matchedDirective: boolean } {
  if (cleaned === '') {
    return { allowed: allowEmpty, nextInContinuation: false, matchedDirective: false }
  }
  const directivePattern = kind === 'hash' ? HASH_DIRECTIVE_LINE : CODE_DIRECTIVE_LINE
  if (directivePattern.test(cleaned)) {
    const startsParagraph =
      PARAGRAPH_TAG_START.test(cleaned) ||
      (kind === 'hash' && /^Copyright\s+(?:\(c\)|©)\s+\S/i.test(cleaned))
    return { allowed: true, nextInContinuation: startsParagraph, matchedDirective: true }
  }
  if (allowJsTypeAnnotation && kind !== 'hash' && JS_TYPE_ANNOTATION_LINE.test(cleaned)) {
    return { allowed: true, nextInContinuation: false, matchedDirective: true }
  }
  if (inContinuation && !cleaned.startsWith('@')) {
    return { allowed: true, nextInContinuation: true, matchedDirective: false }
  }
  return { allowed: false, nextInContinuation: false, matchedDirective: false }
}

export function checkCommentsInSource(filePath: string, text: string): CommentViolation[] {
  if (isExcludedPath(filePath) || !isSupportedPath(filePath)) return []
  const ext = extname(filePath).toLowerCase()
  const allowJsTypeAnnotation = JS_ONLY_EXTENSIONS.has(ext)

  const tokens = JS_EXTENSIONS.has(ext)
    ? scanJsComments(filePath, text)
    : NATIVE_EXTENSIONS.has(ext)
      ? scanNativeComments(filePath, text)
      : PYTHON_EXTENSIONS.has(ext)
        ? scanPythonComments(text)
        : scanRubyComments(text)

  const violations: CommentViolation[] = []

  let prevLineEndLine = -2
  let prevWholeLine = false
  let inLineContinuation = false
  let inLicenseHeader = false

  for (const token of tokens) {
    if (token.kind === 'line' || token.kind === 'hash') {
      const contiguous = token.line === prevLineEndLine + 1 && prevWholeLine && token.wholeLine
      if (!contiguous) {
        inLineContinuation = false
        inLicenseHeader = false
      }
      const cleaned = stripCommentSyntax(token.text, token.kind)
      if (token.kind === 'hash' && inLicenseHeader && cleaned === '') {
        prevLineEndLine = token.line
        prevWholeLine = token.wholeLine
        continue
      }
      const { allowed, nextInContinuation } = isAllowedCommentLine(
        cleaned,
        token.kind,
        allowJsTypeAnnotation,
        inLineContinuation || inLicenseHeader,
        false,
      )
      if (token.kind === 'hash' && /^Copyright\s+(?:\(c\)|©)\s+\S/i.test(cleaned)) {
        inLicenseHeader = token.wholeLine
      }
      inLineContinuation = token.wholeLine ? nextInContinuation : false
      prevLineEndLine = token.line
      prevWholeLine = token.wholeLine
      if (!allowed) {
        violations.push({
          file: filePath,
          line: token.line,
          snippet: token.text.trim().slice(0, 100),
        })
      }
      continue
    }

    inLineContinuation = false
    inLicenseHeader = false
    prevLineEndLine = -2
    prevWholeLine = false

    const lines = token.text.split('\n')
    let inBlockContinuation = false
    let hasDirective = false
    let firstDisallowedLine: { line: number; raw: string } | null = null

    for (let idx = 0; idx < lines.length; idx++) {
      const cleaned = stripCommentSyntax(lines[idx], token.kind)
      const { allowed, nextInContinuation, matchedDirective } = isAllowedCommentLine(
        cleaned,
        token.kind,
        allowJsTypeAnnotation,
        inBlockContinuation,
        true,
      )
      if (matchedDirective) hasDirective = true
      inBlockContinuation = nextInContinuation
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
    } else if (!hasDirective) {
      violations.push({
        file: filePath,
        line: token.line,
        snippet: token.text.trim().slice(0, 100),
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

export function parseStagedEntries(rawZOutput: string): Array<{ mode: string; path: string }> {
  const parts = rawZOutput.split('\0')
  const entries: Array<{ mode: string; path: string }> = []
  let idx = 0
  while (idx < parts.length) {
    const header = parts[idx++]
    if (!header || !header.startsWith(':')) continue
    const fields = header.slice(1).split(' ')
    const newMode = fields[1] ?? ''
    const status = fields[4] ?? ''
    if (status.startsWith('R') || status.startsWith('C')) {
      idx++
      const destPath = parts[idx++]
      if (destPath) entries.push({ mode: newMode, path: destPath })
    } else {
      const filePath = parts[idx++]
      if (filePath) entries.push({ mode: newMode, path: filePath })
    }
  }
  return entries
}

export function runStagedCommentLint(cwd = process.cwd()): CommentViolation[] {
  const output = execFileSync('git', ['diff', '--cached', '--raw', '-z', '--diff-filter=ACMRT'], {
    cwd,
    encoding: 'utf8',
  })
  const entries = parseStagedEntries(output).filter(
    (entry) =>
      entry.mode !== '120000' && isSupportedPath(entry.path) && !isExcludedPath(entry.path),
  )

  const violations: CommentViolation[] = []
  for (const entry of entries) {
    const text = execFileSync('git', ['show', `:${entry.path}`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    violations.push(...checkCommentsInSource(entry.path, text))
  }
  return violations
}

function runCommentLint(fileArgs: string[], cwd = process.cwd()): CommentViolation[] {
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
  const staged = args.includes('--staged')
  const files = args
    .filter((arg) => arg !== '--staged')
    .map((file) => relative(process.cwd(), resolve(file)))
  const violations = staged ? runStagedCommentLint() : runCommentLint(files)
  for (const v of violations) {
    console.error(`${v.file}:${v.line}: disallowed comment: ${v.snippet}`)
  }
  if (violations.length > 0) {
    console.error(
      `\nFound ${violations.length} disallowed comment(s). Preserve valid tool directives and contract metadata. Document architectural decisions in docs/adr/.`,
    )
    process.exitCode = 1
  }
}
