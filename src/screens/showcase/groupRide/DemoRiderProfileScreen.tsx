import { Stack } from 'expo-router/js-stack'
import { useLocalSearchParams } from 'expo-router'

import { PageScrollView } from '@/components/base/PageScrollView'
import { Text } from '@/components/base/Text'
import { RiderLiveRide } from '@/modules/group-ride/components/RiderLiveRide'
import { FIXTURE_ROSTER_ROWS } from '@/screens/showcase/mapShowcaseFixtures'

export default function DemoRiderProfileScreen() {
  const { riderId } = useLocalSearchParams<{ riderId: string }>()
  const rider = FIXTURE_ROSTER_ROWS.find((row) => row.id === riderId)

  return (
    <>
      <Stack.Screen options={{ title: rider ? `${rider.name} · Demo` : 'Demo rider' }} />
      <PageScrollView contentContainerStyle={{ padding: 16 }}>
        {rider?.presence && !rider.stale && !rider.away ? (
          <RiderLiveRide readings={rider.presence} />
        ) : (
          <Text>No live ride</Text>
        )}
      </PageScrollView>
    </>
  )
}
