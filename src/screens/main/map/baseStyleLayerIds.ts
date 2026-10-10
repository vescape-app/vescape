/** IDs available to `existing` overrides in the selected style document. */
export function baseStyleLayerIds(styleJSON?: string): ReadonlySet<string> {
  if (!styleJSON) {
    // Mapbox Outdoors v11 and Satellite Streets v11 both contain these label layers.
    return new Set(['poi-label', 'transit-label'])
  }

  const style = JSON.parse(styleJSON) as { layers?: { id?: string }[] }
  return new Set(style.layers?.map((layer) => layer.id).filter((id): id is string => !!id) ?? [])
}
