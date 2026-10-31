/**
 * Markdown source → a small render-ready tree.
 *
 * `markdown-it` produces a flat token stream; this module folds it into nested
 * blocks and inline runs so the renderer stays a dumb tree walk. Keeping the
 * model pure also keeps it testable without a React renderer.
 *
 * Safety: HTML is disabled, so raw tags arrive as plain text and stay inert.
 * Every URL passes `md.validateLink` (rejects `javascript:`, `vbscript:`,
 * `file:`, and non-image `data:`); a rejected link degrades to its label text
 * and a rejected image to its alt text.
 *
 * Unknown tokens (parser upgrades, future plugins) never throw: unknown
 * containers contribute their children to the parent, unknown leaves are
 * dropped.
 */

import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'strike'; children: MarkdownInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: MarkdownInline[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'break'; hard: boolean }

export type MarkdownAlign = 'left' | 'center' | 'right'

export type MarkdownBlock =
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'heading'; level: number; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: MarkdownBlock[][] }
  | { type: 'quote'; children: MarkdownBlock[] }
  | { type: 'code'; value: string; language: string | null }
  | { type: 'rule' }
  | {
      type: 'table'
      align: (MarkdownAlign | null)[]
      header: MarkdownInline[][]
      rows: MarkdownInline[][][]
    }

/** A paragraph split into text runs and the block-level images between them. */
export type MarkdownRun =
  { kind: 'text'; nodes: MarkdownInline[] } | { kind: 'image'; src: string; alt: string }

const md = new MarkdownIt('default', {
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
})

/** Cursor into the flat token stream, shared by the mutually recursive readers. */
interface Cursor {
  i: number
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  return buildBlocks(md.parse(source, {}))
}

/** Exposed separately so degradation can be tested against synthetic tokens. */
export function buildBlocks(tokens: Token[]): MarkdownBlock[] {
  return readBlocks(tokens, { i: 0 }, null)
}

function readBlocks(tokens: Token[], cursor: Cursor, closeType: string | null): MarkdownBlock[] {
  const out: MarkdownBlock[] = []

  while (cursor.i < tokens.length) {
    const token = tokens[cursor.i]
    if (closeType && token.type === closeType) {
      cursor.i++
      return out
    }
    cursor.i++

    switch (token.type) {
      case 'paragraph_open': {
        const children = readInlineUntil(tokens, cursor, 'paragraph_close')
        if (children.length > 0) out.push({ type: 'paragraph', children })
        break
      }
      case 'heading_open': {
        const children = readInlineUntil(tokens, cursor, 'heading_close')
        out.push({ type: 'heading', level: headingLevel(token.tag), children })
        break
      }
      case 'bullet_list_open':
      case 'ordered_list_open':
        out.push(readList(tokens, cursor, token))
        break
      case 'blockquote_open':
        out.push({ type: 'quote', children: readBlocks(tokens, cursor, 'blockquote_close') })
        break
      case 'fence':
      case 'code_block':
        out.push({
          type: 'code',
          value: token.content.replace(/\n+$/, ''),
          language: token.info.trim().split(/\s+/)[0] || null,
        })
        break
      case 'hr':
        out.push({ type: 'rule' })
        break
      case 'table_open':
        out.push(readTable(tokens, cursor))
        break
      case 'inline': {
        // Inline outside a paragraph — only plugins emit this; keep the text.
        const children = readInline(token.children ?? [])
        if (children.length > 0) out.push({ type: 'paragraph', children })
        break
      }
      default:
        if (token.nesting === 1) out.push(...readBlocks(tokens, cursor, pairedCloseType(token)))
        break
    }
  }

  return out
}

function readList(tokens: Token[], cursor: Cursor, open: Token): MarkdownBlock {
  const ordered = open.type === 'ordered_list_open'
  const closeType = ordered ? 'ordered_list_close' : 'bullet_list_close'
  const items: MarkdownBlock[][] = []

  while (cursor.i < tokens.length) {
    const token = tokens[cursor.i]
    cursor.i++
    if (token.type === closeType) break
    if (token.type === 'list_item_open') items.push(readBlocks(tokens, cursor, 'list_item_close'))
  }

  const start = Number(attr(open, 'start') ?? 1)
  return { type: 'list', ordered, start: Number.isFinite(start) ? start : 1, items }
}

function readTable(tokens: Token[], cursor: Cursor): MarkdownBlock {
  const align: (MarkdownAlign | null)[] = []
  const header: MarkdownInline[][] = []
  const rows: MarkdownInline[][][] = []
  let inHeader = false
  let row: MarkdownInline[][] | null = null

  while (cursor.i < tokens.length) {
    const token = tokens[cursor.i]
    cursor.i++
    if (token.type === 'table_close') break

    switch (token.type) {
      case 'thead_open':
        inHeader = true
        break
      case 'thead_close':
        inHeader = false
        break
      case 'tr_open':
        row = []
        break
      case 'tr_close':
        if (row) {
          if (inHeader && header.length === 0) header.push(...row)
          else rows.push(row)
        }
        row = null
        break
      case 'th_open':
      case 'td_open': {
        const cell = readInlineUntil(
          tokens,
          cursor,
          token.type === 'th_open' ? 'th_close' : 'td_close',
        )
        if (inHeader) align.push(cellAlign(token))
        row?.push(cell)
        break
      }
    }
  }

  return { type: 'table', align, header, rows }
}

function readInlineUntil(tokens: Token[], cursor: Cursor, closeType: string): MarkdownInline[] {
  const out: MarkdownInline[] = []

  while (cursor.i < tokens.length) {
    const token = tokens[cursor.i]
    cursor.i++
    if (token.type === closeType) break
    if (token.type === 'inline') out.push(...readInline(token.children ?? []))
  }

  return out
}

function readInline(tokens: Token[]): MarkdownInline[] {
  return readInlineNodes(tokens, { i: 0 }, null)
}

function readInlineNodes(
  tokens: Token[],
  cursor: Cursor,
  closeType: string | null,
): MarkdownInline[] {
  const out: MarkdownInline[] = []

  while (cursor.i < tokens.length) {
    const token = tokens[cursor.i]
    if (closeType && token.type === closeType) {
      cursor.i++
      return out
    }
    cursor.i++

    switch (token.type) {
      case 'text':
        if (token.content) out.push({ type: 'text', value: token.content })
        break
      case 'code_inline':
        out.push({ type: 'code', value: token.content })
        break
      case 'softbreak':
        out.push({ type: 'break', hard: false })
        break
      case 'hardbreak':
        out.push({ type: 'break', hard: true })
        break
      case 'image': {
        const src = safeUrl(attr(token, 'src'))
        const alt = token.content
        if (src) out.push({ type: 'image', src, alt })
        else if (alt) out.push({ type: 'text', value: alt })
        break
      }
      case 'strong_open':
        out.push({ type: 'strong', children: readInlineNodes(tokens, cursor, 'strong_close') })
        break
      case 'em_open':
        out.push({ type: 'em', children: readInlineNodes(tokens, cursor, 'em_close') })
        break
      case 's_open':
        out.push({ type: 'strike', children: readInlineNodes(tokens, cursor, 's_close') })
        break
      case 'link_open': {
        const href = safeUrl(attr(token, 'href'))
        const children = readInlineNodes(tokens, cursor, 'link_close')
        if (href) out.push({ type: 'link', href, children })
        else out.push(...children)
        break
      }
      default:
        if (token.nesting === 1)
          out.push(...readInlineNodes(tokens, cursor, pairedCloseType(token)))
        break
    }
  }

  return out
}

/**
 * Images fill the container width, which no `Text` run can do, so a paragraph
 * renders as alternating text runs and standalone images.
 */
export function splitInlineRuns(children: MarkdownInline[]): MarkdownRun[] {
  const runs: MarkdownRun[] = []
  let nodes: MarkdownInline[] = []

  const flush = () => {
    if (nodes.some((node) => node.type !== 'break')) runs.push({ kind: 'text', nodes })
    nodes = []
  }

  for (const node of children) {
    if (node.type === 'image') {
      flush()
      runs.push({ kind: 'image', src: node.src, alt: node.alt })
    } else {
      nodes.push(node)
    }
  }
  flush()

  return runs
}

function safeUrl(raw: string | null): string | null {
  const url = raw?.trim()
  if (!url) return null
  return md.validateLink(url) ? url : null
}

function attr(token: Token, name: string): string | null {
  return token.attrs?.find(([key]) => key === name)?.[1] ?? null
}

function cellAlign(token: Token): MarkdownAlign | null {
  const style = attr(token, 'style') ?? ''
  if (style.includes('text-align:center')) return 'center'
  if (style.includes('text-align:right')) return 'right'
  if (style.includes('text-align:left')) return 'left'
  return null
}

function headingLevel(tag: string): number {
  const level = Number(tag.replace('h', ''))
  return Number.isFinite(level) ? Math.min(6, Math.max(1, level)) : 1
}

/** Best-effort close token for a container this module does not know about. */
function pairedCloseType(token: Token): string {
  return token.type.endsWith('_open')
    ? `${token.type.slice(0, -'_open'.length)}_close`
    : `${token.type}_close`
}
