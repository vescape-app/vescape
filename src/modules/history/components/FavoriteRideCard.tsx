import type { Favorite } from 'vescape-core'

import { theme } from '@/constants/theme'
import { RidePreviewCard } from '@/modules/history/components/RidePreviewCard'
import { useRideFormat } from '@/modules/history/hooks/useRideFormat'
import { formatFavoriteName } from '@/modules/history/lib/rideFormat'
import type { RoutePoint } from '@/modules/history/lib/routePreview'

interface FavoriteRideCardProps {
  favorite: Favorite
  routePoints: RoutePoint[]
  onPress: () => void
}

/** A Favorite uses the same browsable tile as a recent ride. */
export function FavoriteRideCard({ favorite, routePoints, onPress }: FavoriteRideCardProps) {
  const { formatRideDetails } = useRideFormat()

  return (
    <RidePreviewCard
      title={formatFavoriteName(favorite.name, favorite.startMs, favorite.endMs)}
      subtitle={formatRideDetails(favorite.movingDurationMs, favorite.distanceM, null)}
      routePoints={routePoints}
      color={theme.palette.amber.color}
      onPress={onPress}
    />
  )
}
