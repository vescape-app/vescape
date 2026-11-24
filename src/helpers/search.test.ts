import { describe, expect, test } from 'bun:test'

import { searchCatalog, searchItems, tokenizeSearchQuery } from './search'

describe('search helpers', () => {
  test('tokenizes queries and strips stopwords and punctuation', () => {
    expect(tokenizeSearchQuery('The quick-start of a board!')).toEqual(['quick', 'start', 'board'])
    expect(tokenizeSearchQuery('   ---  ')).toEqual([])
  })

  test('matches PascalCase and camelCase tokens as both full words and split parts', () => {
    const items = [
      { id: '1', name: 'SearchInput' },
      { id: '2', name: 'IconButtonExtension' },
      { id: '3', name: 'BmsCellVoltages' },
    ]
    const find = (q: string) =>
      searchItems(items, q, (item) => [
        { text: item.name, weight: 10, fuzzy: true, phrase: true },
      ]).map((hit) => hit.item.name)

    expect(find('search input')).toEqual(['SearchInput'])
    expect(find('searchinput')).toEqual(['SearchInput'])
    expect(find('input')).toEqual(['SearchInput'])
    expect(find('button')).toEqual(['IconButtonExtension'])
    expect(find('cell voltages')).toEqual(['BmsCellVoltages'])
  })

  test('searchCatalog ranks matching sections and deep-linked items', () => {
    const groups = [
      {
        title: 'Preferences',
        sections: [
          {
            label: 'Map',
            hint: 'Map appearance and satellite imagery',
            route: '/settings/map',
            items: [
              {
                id: 'hide-poi',
                label: 'Hide telemetry map details',
                keywords: ['poi', 'labels'],
              },
              {
                id: 'reroute',
                label: 'Recalculate beyond',
                keywords: ['navigation', 'off-route'],
              },
            ],
          },
        ],
      },
    ]

    const mapHits = searchCatalog(groups, 'map')
    expect(mapHits[0]?.kind).toBe('section')
    expect(mapHits[0]?.route).toBe('/settings/map')

    const poiHits = searchCatalog(groups, 'poi')
    expect(poiHits).toHaveLength(1)
    expect(poiHits[0]?.kind).toBe('item')
    expect(poiHits[0]?.focus).toBe('hide-poi')
    expect(poiHits[0]?.route).toBe('/settings/map')
  })
})
