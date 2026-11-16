import { Stack } from 'expo-router/js-stack'
import { useLocalSearchParams } from 'expo-router'
import { ScrollView } from 'react-native'

import { Text } from '@/components/base/Text'
import { RiderLiveRide } from '@/modules/group-ride/components/RiderLiveRide'
import { FIXTURE_ROSTER_ROWS } from '@/screens/showcase/mapShowcaseFixtures'

export default function DemoRiderProfileScreen() {
  const { riderId } = useLocalSearchParams<{ riderId: string }>()
  const rider = FIXTURE_ROSTER_ROWS.find((row) => row.id === riderId)

  return (
    <>
      <Stack.Screen options={{ title: rider ? `${rider.name} · Demo` : 'Demo rider' }} />
      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {rider?.presence ? (
          <RiderLiveRide
            readings={rider.presence}
            stale={rider.stale || rider.away}
            lastSeen={rider.lastSeen}
          />
        ) : (
          <Text>No live ride</Text>
        )}
      </ScrollView>
    </>
  )
}
