interface PreviewRouteSample {
  latitude: number
  longitude: number
}

/**
 * The route drawn while a ride's full samples are still loading. Built from the Ride Track, which
 * is the route stream — telemetry carries no position (ADR 0038).
 */
export function getHistoryPreviewRoute(gpsSamples: PreviewRouteSample[]): [number, number][] {
  return gpsSamples.flatMap((sample) =>
    Number.isFinite(sample.latitude) && Number.isFinite(sample.longitude)
      ? [[sample.longitude, sample.latitude] as [number, number]]
      : [],
  )
}
