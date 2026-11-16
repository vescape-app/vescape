import { RiderLiveRide } from '@/modules/group-ride/components/RiderLiveRide'
import { useOwnRiderReadings } from '@/modules/group-ride/hooks/useOwnRiderReadings'

export function OwnRiderLiveRide() {
  const readings = useOwnRiderReadings()
  return <RiderLiveRide readings={readings} />
}
