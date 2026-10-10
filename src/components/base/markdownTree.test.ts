import { describe, expect, test } from 'bun:test'
import Token from 'markdown-it/lib/token.mjs'

import {
  buildBlocks,
  parseMarkdown,
  splitInlineRuns,
  type MarkdownBlock,
  type MarkdownInline,
} from '@/components/base/markdownTree'

/** Flatten a block tree back to plain text so structural assertions stay short. */
function inlineText(nodes: MarkdownInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value
        case 'strong':
        case 'em':
        case 'strike':
        case 'link':
          return inlineText(node.children)
        case 'image':
          return `[img:${node.src}]`
        case 'break':
          return node.hard ? '\n' : ' '
      }
    })
    .join('')
}

function only<T extends MarkdownBlock['type']>(
  source: string,
  type: T,
): Extract<MarkdownBlock, { type: T }> {
  const blocks = parseMarkdown(source)
  expect(blocks).toHaveLength(1)
  expect(blocks[0].type).toBe(type)
  return blocks[0] as Extract<MarkdownBlock, { type: T }>
}

describe('block structures', () => {
  test('parses headings with their level', () => {
    expect(only('### Ride safe', 'heading').level).toBe(3)
    expect(only('# Ride safe', 'heading').level).toBe(1)
  })

  test('drops empty paragraphs instead of emitting blank blocks', () => {
    expect(parseMarkdown('\n\n   \n\n')).toEqual([])
  })

  test('keeps fence language and strips the trailing newline', () => {
    const code = only('```kotlin\nval a = 1\n```', 'code')
    expect(code).toEqual({ type: 'code', value: 'val a = 1', language: 'kotlin' })
  })

  test('fence without an info string has no language', () => {
    expect(only('```\nplain\n```', 'code').language).toBeNull()
  })

  test('parses horizontal rules', () => {
    expect(only('---', 'rule')).toEqual({ type: 'rule' })
  })

  test('parses blockquotes as nested blocks', () => {
    const quote = only('> **Heads up**\n>\n> Update soon.', 'quote')
    expect(quote.children.map((child) => child.type)).toEqual(['paragraph', 'paragraph'])
  })

  test('distinguishes soft and hard breaks', () => {
    const paragraph = only('soft\nbreak', 'paragraph')
    expect(paragraph.children).toContainEqual({ type: 'break', hard: false })
    expect(only('hard\\\nbreak', 'paragraph').children).toContainEqual({
      type: 'break',
      hard: true,
    })
  })
})

describe('nesting', () => {
  test('nests a bullet list inside an ordered list item', () => {
    const list = only('1. one\n   - alpha\n   - beta\n2. two', 'list')
    expect(list.ordered).toBe(true)
    expect(list.start).toBe(1)
    expect(list.items).toHaveLength(2)

    const [first] = list.items
    expect(first.map((block) => block.type)).toEqual(['paragraph', 'list'])

    const nested = first[1] as Extract<MarkdownBlock, { type: 'list' }>
    expect(nested.ordered).toBe(false)
    expect(
      nested.items.map((item) =>
        inlineText((item[0] as Extract<MarkdownBlock, { type: 'paragraph' }>).children),
      ),
    ).toEqual(['alpha', 'beta'])
  })

  test('keeps the ordered list start marker', () => {
    expect(only('5. five\n6. six', 'list').start).toBe(5)
  })

  test('nests emphasis inside a link label', () => {
    const paragraph = only('[**bold** link](https://vescape.app)', 'paragraph')
    const link = paragraph.children[0] as Extract<MarkdownInline, { type: 'link' }>
    expect(link.type).toBe('link')
    expect(link.children[0].type).toBe('strong')
    expect(inlineText(link.children)).toBe('bold link')
  })

  test('nests blocks inside a blockquote inside a list item', () => {
    const list = only('- item\n\n  > quoted', 'list')
    expect(list.items[0].map((block) => block.type)).toEqual(['paragraph', 'quote'])
  })
})

describe('links', () => {
  test('keeps http and mailto links', () => {
    const paragraph = only('[site](https://vescape.app) [mail](mailto:a@b.c)', 'paragraph')
    const hrefs = paragraph.children
      .filter((node) => node.type === 'link')
      .map((node) => (node as Extract<MarkdownInline, { type: 'link' }>).href)
    expect(hrefs).toEqual(['https://vescape.app', 'mailto:a@b.c'])
  })

  test('rejects a javascript: link and keeps its label as text', () => {
    const paragraph = only('[tap me](javascript:alert(1))', 'paragraph')
    expect(paragraph.children.some((node) => node.type === 'link')).toBe(false)
    expect(inlineText(paragraph.children)).toContain('tap me')
  })

  test('rejects an unsafe autolink', () => {
    const paragraph = only('<javascript:alert(1)>', 'paragraph')
    expect(paragraph.children.some((node) => node.type === 'link')).toBe(false)
  })

  test('degrades an empty href to plain text', () => {
    const paragraph = only('[label]()', 'paragraph')
    expect(paragraph.children.some((node) => node.type === 'link')).toBe(false)
    expect(inlineText(paragraph.children)).toBe('label')
  })
})

describe('images', () => {
  test('parses an image with its alt text', () => {
    const paragraph = only('![Board photo](https://vescape.app/a.png)', 'paragraph')
    expect(paragraph.children[0]).toEqual({
      type: 'image',
      src: 'https://vescape.app/a.png',
      alt: 'Board photo',
    })
  })

  test('rejects an unsafe image source and keeps the alt text', () => {
    const paragraph = only('![Board photo](javascript:alert(1))', 'paragraph')
    expect(paragraph.children.some((node) => node.type === 'image')).toBe(false)
    expect(inlineText(paragraph.children)).toContain('Board photo')
  })

  test('lifts images out of a paragraph into standalone runs', () => {
    const paragraph = only('before\n![a](https://x/a.png)\nafter', 'paragraph')
    const runs = splitInlineRuns(paragraph.children)
    expect(runs.map((run) => run.kind)).toEqual(['text', 'image', 'text'])
    expect(runs[1]).toEqual({ kind: 'image', src: 'https://x/a.png', alt: 'a' })
  })

  test('does not emit a text run that holds only breaks', () => {
    const paragraph = only('![a](https://x/a.png)\n![b](https://x/b.png)', 'paragraph')
    expect(splitInlineRuns(paragraph.children).map((run) => run.kind)).toEqual(['image', 'image'])
  })
})

describe('tables', () => {
  test('parses header, rows, and per-column alignment', () => {
    const table = only(
      ['| Metric | Value | Note |', '| :--- | ---: | :-: |', '| Speed | 42 | ok |'].join('\n'),
      'table',
    )
    expect(table.header.map(inlineText)).toEqual(['Metric', 'Value', 'Note'])
    expect(table.rows.map((row) => row.map(inlineText))).toEqual([['Speed', '42', 'ok']])
    expect(table.align).toEqual(['left', 'right', 'center'])
  })

  test('leaves alignment null when the delimiter row has none', () => {
    const table = only('| a | b |\n| --- | --- |\n| 1 | 2 |', 'table')
    expect(table.align).toEqual([null, null])
  })

  test('keeps inline formatting inside cells', () => {
    const table = only('| a |\n| --- |\n| [x](https://x.com) |', 'table')
    expect(table.rows[0][0][0].type).toBe('link')
  })
})

describe('raw HTML', () => {
  test('renders block-level HTML as inert text', () => {
    const paragraph = only('<script>alert(1)</script>', 'paragraph')
    expect(paragraph.children).toEqual([{ type: 'text', value: '<script>alert(1)</script>' }])
  })

  test('renders inline HTML as inert text', () => {
    const paragraph = only('a <b onclick="x()">bold</b> c', 'paragraph')
    expect(inlineText(paragraph.children)).toBe('a <b onclick="x()">bold</b> c')
    expect(paragraph.children.every((node) => node.type === 'text')).toBe(true)
  })
})

describe('graceful degradation', () => {
  const token = (type: string, nesting: -1 | 0 | 1, content = '') => {
    const t = new Token(type, '', nesting)
    t.content = content
    return t
  }

  const inline = (content: string) => {
    const t = token('inline', 0, content)
    t.children = [token('text', 0, content)]
    return t
  }

  test('unwraps an unknown container and keeps its blocks', () => {
    const blocks = buildBlocks([
      token('future_container_open', 1),
      token('paragraph_open', 1),
      inline('kept'),
      token('paragraph_close', -1),
      token('future_container_close', -1),
      token('paragraph_open', 1),
      inline('sibling'),
      token('paragraph_close', -1),
    ])
    expect(
      blocks.map((block) =>
        inlineText((block as Extract<MarkdownBlock, { type: 'paragraph' }>).children),
      ),
    ).toEqual(['kept', 'sibling'])
  })

  test('ignores an unknown leaf token', () => {
    const blocks = buildBlocks([
      token('future_widget', 0, 'ignored'),
      token('paragraph_open', 1),
      inline('kept'),
      token('paragraph_close', -1),
    ])
    expect(blocks).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: 'kept' }] }])
  })

  test('survives an unknown container that never closes', () => {
    const blocks = buildBlocks([
      token('future_container_open', 1),
      token('paragraph_open', 1),
      inline('kept'),
      token('paragraph_close', -1),
    ])
    expect(
      blocks.map((block) =>
        inlineText((block as Extract<MarkdownBlock, { type: 'paragraph' }>).children),
      ),
    ).toEqual(['kept'])
  })

  test('unwraps an unknown inline container and keeps its text', () => {
    const wrapper = token('inline', 0)
    wrapper.children = [
      token('future_mark_open', 1),
      token('text', 0, 'still here'),
      token('future_mark_close', -1),
    ]
    const blocks = buildBlocks([token('paragraph_open', 1), wrapper, token('paragraph_close', -1)])
    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'still here' }] },
    ])
  })

  test('ignores a stray close token', () => {
    expect(buildBlocks([token('paragraph_close', -1), token('hr', 0)])).toEqual([{ type: 'rule' }])
  })

  test('keeps inline content that arrives outside a paragraph', () => {
    expect(buildBlocks([inline('loose')])).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'loose' }] },
    ])
  })
})
