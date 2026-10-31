export type JsonTokenType =
  'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'plain'

export interface JsonToken {
  text: string
  type: JsonTokenType
}

const TOKEN_RE =
  /"(?:\\.|[^"\\])*"(\s*:)?|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],]/g

/**
 * Tokenize a value's pretty-printed JSON into typed spans for syntax highlighting.
 * Pure: no React, no rendering — callers map token types to colors.
 */
export function tokenizeJson(value: unknown, indent = 2): JsonToken[] {
  const json = JSON.stringify(value, null, indent)
  if (json === undefined) return [{ text: String(value), type: 'plain' }]

  const tokens: JsonToken[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0

  while ((match = TOKEN_RE.exec(json)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: json.slice(lastIndex, match.index), type: 'plain' })
    }

    const raw = match[0]
    const colonSuffix = match[1]

    if (raw.startsWith('"')) {
      if (colonSuffix !== undefined) {
        tokens.push({ text: raw.slice(0, raw.length - colonSuffix.length), type: 'key' })
        tokens.push({ text: colonSuffix, type: 'punctuation' })
      } else {
        tokens.push({ text: raw, type: 'string' })
      }
    } else if (raw === 'true' || raw === 'false') {
      tokens.push({ text: raw, type: 'boolean' })
    } else if (raw === 'null') {
      tokens.push({ text: raw, type: 'null' })
    } else if (/^-?\d/.test(raw)) {
      tokens.push({ text: raw, type: 'number' })
    } else {
      tokens.push({ text: raw, type: 'punctuation' })
    }

    lastIndex = match.index + raw.length
  }

  if (lastIndex < json.length) {
    tokens.push({ text: json.slice(lastIndex), type: 'plain' })
  }

  return tokens
}
