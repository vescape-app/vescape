import { StyleSheet, View } from 'react-native'
import {
  BroadcastIcon,
  CheckIcon,
  ClockIcon,
  UserCircleIcon,
  UserPlusIcon,
  UsersIcon,
} from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { RiderProfileSections } from './RiderProfileSections'
import { DEMO_PROFILE_BOARDS } from './profileFixtures'
import { usePublicRidePrototypeStore } from './prototypeStore'
import type { MockRider } from './fixtures'

/** Selected person in the dashboard Social drawer. Public profile metadata remains demo-only. */
export function RiderProfileDetail({
  rider,
  onShowOnMap,
}: {
  rider: MockRider
  onShowOnMap: () => void
}) {
  const requested = usePublicRidePrototypeStore((s) => s.friendRequests.includes(rider.id))
  const requestFriend = usePublicRidePrototypeStore((s) => s.requestFriend)
  const active = rider.freshness !== 'offline'
  const tone = rider.freshness === 'live' ? theme.palette.green : theme.palette.amber
  const StatusIcon = rider.freshness === 'live' ? BroadcastIcon : ClockIcon
  const boards = DEMO_PROFILE_BOARDS.map((board, index) =>
    index === 0 && rider.board ? { ...board, name: rider.board } : board,
  )
  return (
    <View testID="public-rider-detail">
      <RiderProfileSections
        variant={2}
        rider={rider}
        boards={boards}
        active={active}
        onShowOnMap={onShowOnMap}
        identity={
          <View style={s.row}>
            <UserCircleIcon size={46} color={theme.neutral.textSecondary} weight="thin" />
            <View style={s.flex}>
              <Text style={s.name}>{rider.name}</Text>
              <View style={s.status}>
                <StatusIcon size={14} color={tone.color} />
                <Text style={[s.caption, { color: tone.text }]}>
                  {active
                    ? `${rider.freshness === 'live' ? 'Live' : 'Last update'} · ${rider.age}`
                    : rider.age}
                </Text>
              </View>
            </View>
            {rider.friend || requested ? (
              <View style={s.status}>
                {rider.friend ? (
                  <UsersIcon size={15} color={theme.palette.purple.color} />
                ) : (
                  <CheckIcon size={15} color={theme.neutral.textSecondary} />
                )}
                <Text style={s.caption}>{rider.friend ? 'Friends' : 'Requested'}</Text>
              </View>
            ) : (
              <Button
                label="Add friend"
                icon={UserPlusIcon}
                size="sm"
                variant="secondary"
                onPress={() => requestFriend(rider.id)}
              />
            )}
          </View>
        }
      />
    </View>
  )
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  name: { fontSize: 24, fontWeight: '700', color: theme.neutral.textPrimary },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  caption: { fontSize: 11, lineHeight: 17, color: theme.neutral.textSecondary, flexShrink: 1 },
})
