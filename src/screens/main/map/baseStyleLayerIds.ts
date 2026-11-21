export const MAPBOX_V11_DISTRICT_LABEL_LAYER_IDS = [
  'state-label',
  'settlement-subdivision-label',
  'settlement-minor-label',
] as const

export function baseStyleLayerIds(styleJSON?: string): ReadonlySet<string> {
  if (!styleJSON) {
    return new Set(['poi-label', 'transit-label', ...MAPBOX_V11_DISTRICT_LABEL_LAYER_IDS])
  }

  const style = JSON.parse(styleJSON) as { layers?: { id?: string }[] }
  return new Set(style.layers?.map((layer) => layer.id).filter((id): id is string => !!id) ?? [])
}
