export type PlaceCategoryIconKey =
  | 'nature'
  | 'food'
  | 'coffee'
  | 'shopping'
  | 'lodging'
  | 'health'
  | 'parking'
  | 'school'
  | 'university'
  | 'bus'
  | 'tram'
  | 'rail'
  | 'airport'
  | 'fuel'
  | 'cycling'
  | 'finance'
  | 'worship'
  | 'fitness'
  | 'sports'
  | 'swimming'
  | 'scenic'
  | 'place'

const PLACE_CATEGORY_ICON_KEYS: readonly {
  keywords: readonly string[]
  key: PlaceCategoryIconKey
}[] = [
  { keywords: ['parking', 'car park'], key: 'parking' },
  { keywords: ['park', 'garden', 'forest', 'nature'], key: 'nature' },
  { keywords: ['restaurant', 'food', 'fast food'], key: 'food' },
  { keywords: ['cafe', 'coffee'], key: 'coffee' },
  { keywords: ['shop', 'store', 'retail', 'mall'], key: 'shopping' },
  { keywords: ['hotel', 'lodging', 'hostel'], key: 'lodging' },
  { keywords: ['hospital', 'clinic', 'pharmacy'], key: 'health' },
  { keywords: ['school', 'kindergarten'], key: 'school' },
  { keywords: ['college', 'university', 'campus'], key: 'university' },
  { keywords: ['bus', 'coach'], key: 'bus' },
  { keywords: ['tram', 'streetcar'], key: 'tram' },
  { keywords: ['railway', 'rail', 'train', 'metro', 'subway', 'station'], key: 'rail' },
  { keywords: ['airport', 'airfield', 'aerodrome'], key: 'airport' },
  { keywords: ['fuel', 'gas'], key: 'fuel' },
  { keywords: ['cycle', 'bicycle', 'bike'], key: 'cycling' },
  { keywords: ['bank', 'atm', 'finance'], key: 'finance' },
  { keywords: ['church', 'chapel', 'mosque', 'synagogue', 'worship'], key: 'worship' },
  { keywords: ['gym', 'fitness'], key: 'fitness' },
  { keywords: ['stadium', 'sports', 'pitch'], key: 'sports' },
  { keywords: ['swimming', 'pool'], key: 'swimming' },
  { keywords: ['attraction', 'museum', 'monument', 'landmark'], key: 'scenic' },
]

export function getPlaceCategoryIconKey(category: string | null): PlaceCategoryIconKey {
  const normalized = category?.toLowerCase() ?? ''
  return (
    PLACE_CATEGORY_ICON_KEYS.find(({ keywords }) =>
      keywords.some((keyword) => normalized.includes(keyword)),
    )?.key ?? 'place'
  )
}
