import { publicRideMapRiderId } from '@/modules/group-ride/components/public-ride-prototype/fixtures'
import type { PublicRideMapRequest } from '@/modules/group-ride/components/public-ride-prototype/prototypeStore'

/** Never frame a partial selection: profile framing must include both the rider and ourselves. */
export function publicRideMapCoordinates(
  request: PublicRideMapRequest,
  riders: readonly { id: string; presence: { lng: number; lat: number } | null }[],
  selfLocation: { longitude: number; latitude: number } | null,
): [number, number][] | null {
  const ids = new Set(request.riderIds.map(publicRideMapRiderId))
  const coordinates = riders.flatMap((rider): [number, number][] =>
    ids.has(rider.id) &&
    rider.presence &&
    Number.isFinite(rider.presence.lng) &&
    Number.isFinite(rider.presence.lat)
      ? [[rider.presence.lng, rider.presence.lat]]
      : [],
  )
  if (coordinates.length !== ids.size || !coordinates.length) return null
  if (request.includeSelf) {
    if (
      !selfLocation ||
      !Number.isFinite(selfLocation.longitude) ||
      !Number.isFinite(selfLocation.latitude)
    )
      return null
    coordinates.push([selfLocation.longitude, selfLocation.latitude])
  }
  return coordinates
}
