import { boardConfigSearchKeywords } from '@/modules/board/constants/boardConfigSearchKeywords'
import type { BoardConfigGroup } from '@/modules/board/constants/boardConfigTabs'

type Source = BoardConfigGroup['source']

interface SearchTab {
  id: string
  label: string
  groups: BoardConfigGroup[]
}

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'to', 'for', 'and', 'in', 'on', 'at', 'is'])

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function normalize(text: string): string {
  return words(text).join(' ')
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let beforePrevious: number[] = []
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      let value = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        value = Math.min(value, beforePrevious[j - 2]! + 1)
      current.push(value)
      rowMin = Math.min(rowMin, value)
    }
    if (rowMin > max) return max + 1
    beforePrevious = previous
    previous = current
  }
  return previous[b.length]!
}

function tokenMatch(query: string, candidate: string, fuzzy: boolean): number {
  if (candidate === query) return 1
  if (query.length >= 2 && candidate.startsWith(query)) return 0.8
  if (!fuzzy || query.length < 4) return 0
  const max = query.length >= 8 ? 2 : 1
  const distance = Math.min(
    editDistance(query, candidate, max),
    editDistance(query, candidate.slice(0, query.length), max),
  )
  return distance <= max ? 0.55 : 0
}

interface Field {
  text: string
  tokens: string[]
  weight: number
  fuzzy: boolean
  phrase: boolean
}

function field(text: string, weight: number, fuzzy: boolean, phrase = false): Field {
  return { text: normalize(text), tokens: words(text), weight, fuzzy, phrase }
}

function score(queryText: string, queryTokens: string[], fields: Field[]): number {
  let total = 0
  for (const token of queryTokens) {
    let best = 0
    for (const item of fields)
      for (const candidate of item.tokens)
        best = Math.max(best, tokenMatch(token, candidate, item.fuzzy) * item.weight)
    if (best === 0) return 0
    total += best
  }
  let phrase = 0
  for (const item of fields) {
    if (!item.phrase) continue
    if (item.text === queryText) phrase = Math.max(phrase, 10 * item.weight)
    else if (item.text.startsWith(queryText)) phrase = Math.max(phrase, 4 * item.weight)
    else if (` ${item.text}`.includes(` ${queryText}`)) phrase = Math.max(phrase, 2 * item.weight)
  }
  return total + phrase
}

interface BoardConfigSearchGroup extends BoardConfigGroup {
  tabId: string
}

export function searchBoardConfig(
  tabs: SearchTab[],
  query: string,
  loadedSources: readonly Source[],
): BoardConfigSearchGroup[] {
  const queryTokens = words(query).filter((token) => !STOPWORDS.has(token))
  if (queryTokens.length === 0) return []
  const queryText = queryTokens.join(' ')
  const ordered = [
    ...tabs.filter((tab) => tab.id !== 'quick'),
    ...tabs.filter((tab) => tab.id === 'quick'),
  ]
  const seen = new Set<string>()
  const hits: {
    tab: SearchTab
    group: BoardConfigGroup
    row: BoardConfigGroup['rows'][number]
    score: number
  }[] = []
  for (const tab of ordered)
    for (const group of tab.groups) {
      if (!loadedSources.includes(group.source)) continue
      for (const row of group.rows) {
        const key = `${group.source}:${row.id}`
        if (seen.has(key)) continue
        seen.add(key)
        const keywords = boardConfigSearchKeywords(group.source, row.id)
        const value = score(queryText, queryTokens, [
          field(row.label, 10, true, true),
          ...keywords.map((keyword) => field(keyword, 8, true, true)),
          field(row.id, 6, false),
          field(`${tab.label} ${group.title}`, 3, true),
          field(`${row.description ?? ''} ${row.when ?? ''}`, 2, false),
        ])
        if (value > 0) hits.push({ tab, group, row, score: value })
      }
    }
  hits.sort((a, b) => b.score - a.score)
  const groups = new Map<string, BoardConfigSearchGroup>()
  for (const hit of hits) {
    const key = `${hit.tab.id}|${hit.group.source}|${hit.group.title}`
    const existing = groups.get(key)
    if (existing) existing.rows.push(hit.row)
    else
      groups.set(key, {
        title: `${hit.tab.label} · ${hit.group.title}`,
        source: hit.group.source,
        tabId: hit.tab.id,
        rows: [hit.row],
      })
  }
  return [...groups.values()]
}
