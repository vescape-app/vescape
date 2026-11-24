const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'to', 'for', 'and', 'in', 'on', 'at', 'is'])

export interface SearchField {
  text: string
  weight: number
  fuzzy?: boolean
  phrase?: boolean
}

export interface SearchHit<T> {
  item: T
  score: number
}

export interface SearchableItem {
  id: string
  label: string
  hint?: string
  keywords?: readonly string[]
}

export interface SearchableSection<TRoute = string, TItem extends SearchableItem = SearchableItem> {
  label: string
  hint?: string
  route: TRoute
  keywords?: readonly string[]
  items: readonly TItem[]
}

export interface SearchableGroup<
  TRoute = string,
  TSection extends SearchableSection<TRoute> = SearchableSection<TRoute>,
> {
  title: string
  sections: readonly TSection[]
}

export interface CatalogSearchHit<
  TRoute = string,
  TSection extends SearchableSection<TRoute> = SearchableSection<TRoute>,
  TItem extends SearchableItem = SearchableItem,
> {
  kind: 'section' | 'item'
  id: string
  label: string
  hint: string
  group: string
  route: TRoute
  focus?: string
  section: TSection
  item?: TItem
  score: number
}

function splitCamel(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
}

function rawWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function indexWords(text: string): string[] {
  const base = rawWords(text)
  const split = rawWords(splitCamel(text))
  if (split.length === base.length && split.every((word, index) => word === base[index])) {
    return base
  }
  return [...new Set([...base, ...split])]
}

function normalize(text: string): string {
  return rawWords(splitCamel(text)).join(' ')
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

interface PreparedField {
  text: string
  tokens: string[]
  weight: number
  fuzzy: boolean
  phrase: boolean
}

function prepareField(field: SearchField): PreparedField {
  return {
    text: normalize(field.text),
    tokens: indexWords(field.text),
    weight: field.weight,
    fuzzy: field.fuzzy ?? false,
    phrase: field.phrase ?? false,
  }
}

export function tokenizeSearchQuery(query: string): string[] {
  return rawWords(query).filter((token) => !STOPWORDS.has(token))
}

function scorePrepared(
  queryText: string,
  queryTokens: readonly string[],
  fields: readonly PreparedField[],
): number {
  let total = 0
  for (const token of queryTokens) {
    let best = 0
    for (const item of fields) {
      for (const candidate of item.tokens) {
        best = Math.max(best, tokenMatch(token, candidate, item.fuzzy) * item.weight)
      }
    }
    if (best === 0) return 0
    total += best
  }
  let phrase = 0
  for (const item of fields) {
    if (!item.phrase || !item.text) continue
    if (item.text === queryText) phrase = Math.max(phrase, 10 * item.weight)
    else if (item.text.startsWith(queryText)) phrase = Math.max(phrase, 4 * item.weight)
    else if (` ${item.text}`.includes(` ${queryText}`)) phrase = Math.max(phrase, 2 * item.weight)
  }
  return total + phrase
}

export function searchItems<T>(
  items: readonly T[],
  query: string,
  getFields: (item: T) => readonly SearchField[],
): SearchHit<T>[] {
  const queryTokens = tokenizeSearchQuery(query)
  if (queryTokens.length === 0) return []
  const queryText = queryTokens.join(' ')
  const hits: SearchHit<T>[] = []
  for (const item of items) {
    const score = scorePrepared(queryText, queryTokens, getFields(item).map(prepareField))
    if (score > 0) hits.push({ item, score })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits
}

export function searchCatalog<
  TRoute,
  TItem extends SearchableItem,
  TSection extends SearchableSection<TRoute, TItem>,
>(
  groups: readonly SearchableGroup<TRoute, TSection>[],
  query: string,
): CatalogSearchHit<TRoute, TSection, TItem>[] {
  const queryTokens = tokenizeSearchQuery(query)
  if (queryTokens.length === 0) return []
  const queryText = queryTokens.join(' ')
  const hits: CatalogSearchHit<TRoute, TSection, TItem>[] = []

  for (const group of groups) {
    for (const section of group.sections) {
      const sectionScore = scorePrepared(
        queryText,
        queryTokens,
        [
          { text: section.label, weight: 10, fuzzy: true, phrase: true },
          ...(section.keywords ?? []).map((text) => ({
            text,
            weight: 8,
            fuzzy: true,
            phrase: true,
          })),
          { text: group.title, weight: 3, fuzzy: true },
          { text: section.hint ?? '', weight: 2, fuzzy: false },
        ].map(prepareField),
      )
      if (sectionScore > 0) {
        hits.push({
          kind: 'section',
          id: `section:${String(section.route)}`,
          label: section.label,
          hint: section.hint ? `${group.title} · ${section.hint}` : group.title,
          group: group.title,
          route: section.route,
          section,
          score: sectionScore,
        })
      }

      for (const item of section.items) {
        const itemScore = scorePrepared(
          queryText,
          queryTokens,
          [
            { text: item.label, weight: 10, fuzzy: true, phrase: true },
            ...(item.keywords ?? []).map((text) => ({
              text,
              weight: 8,
              fuzzy: true,
              phrase: true,
            })),
            { text: section.label, weight: 4, fuzzy: true },
            { text: group.title, weight: 2, fuzzy: false },
            { text: item.hint ?? '', weight: 2, fuzzy: false },
          ].map(prepareField),
        )
        if (itemScore > 0) {
          hits.push({
            kind: 'item',
            id: `item:${String(section.route)}:${item.id}`,
            label: item.label,
            hint: item.hint ? `${section.label} · ${item.hint}` : section.label,
            group: group.title,
            route: section.route,
            focus: item.id,
            section,
            item,
            score: itemScore,
          })
        }
      }
    }
  }

  hits.sort((a, b) => b.score - a.score)
  return hits
}
