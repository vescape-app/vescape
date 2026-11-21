interface PreviewRouteSample {
  latitude: number
  longitude: number
}

export function getHistoryPreviewRoute(gpsSamples: PreviewRouteSample[]): [number, number][] {
  return gpsSamples.flatMap((sample) =>
    Number.isFinite(sample.latitude) && Number.isFinite(sample.longitude)
      ? [[sample.longitude, sample.latitude] as [number, number]]
      : [],
  )
}
