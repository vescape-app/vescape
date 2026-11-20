import { Keyboard, StyleSheet, View } from 'react-native'
import type { RiderProfile } from 'vescape-core'
import {
  MagnifyingGlassIcon,
  MapTrifoldIcon,
  CrosshairIcon,
  UsersIcon,
  UsersThreeIcon,
  XIcon,
} from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { SearchInput } from '@/components/forms/SearchInput'
import { Placeholder } from '@/components/base/Placeholder'
import { Text } from '@/components/base/Text'
import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import { useColoredActionForeground } from '@/hooks/useTheme'
import { NEARBY_RIDER_LIMIT, type RosterRider } from '@/modules/group-ride/lib/roster'
import { useOwnRiderReadings } from '@/modules/group-ride/hooks/useOwnRiderReadings'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import { useFriendsStore } from '@/modules/profile/store/friendsStore'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'
import { useDeviceAccountReady } from '@/modules/profile/hooks/useDeviceAccountReady'
import {
  SocialFriendLists,
  SocialFriendsSignIn,
  SocialRiderSearchResults,
} from '@/modules/profile/components/SocialFriendsContent'
import { RosterList } from './GroupRideRoster'

export const INITIAL_SOCIAL_VIEW = { tab: 'nearby', searchOpen: false, query: '' } as const

export interface SocialView {
  tab: 'nearby' | 'friends'
  searchOpen: boolean
  query: string
}

export interface SocialRiderPanelProps {
  view: SocialView
  onViewChange: (view: SocialView) => void
  onOpenProfile: (accountId: string) => void
  onNavigate?: () => void
}

export function SocialRiderPanel({
  view,
  onViewChange,
  onOpenProfile,
  onNavigate,
}: SocialRiderPanelProps) {
  const { tab, searchOpen, query } = view
  const signedIn = useDeviceAccountReady()
  const rows = useGroupRideStore((s) => s.rosterRows)
  const ownLocation = useGroupRideStore((s) => s.ownLocation)
  const live = useGroupRideStore((s) => s.publicRide.live)
  const profile = useRiderProfileStore((s) => s.profile)
  const ownProfile = signedIn ? profile : null
  const nearbyCount =
    rows.filter((rider) => rider.presence && !rider.stale && !rider.away).length + Number(live)
  const ridingFriendCount = useFriendsStore(
    (s) => s.lists.friends.filter((friend) => friend.ridingNow).length,
  )
  const incomingRequestCount = useFriendsStore((s) => s.lists.incoming.length)
  const friendBadgeCount = incomingRequestCount || ridingFriendCount
  const friendBadgeColor = incomingRequestCount > 0 ? theme.palette.blue : theme.palette.green
  const selectedFriendsColor = useColoredActionForeground(theme.palette.blue.color)
  const requestDotColor = tab === 'friends' ? selectedFriendsColor : theme.palette.blue.color
  const surface = useResolvedSecondaryWidgetSurface()

  function openRider(accountId: string) {
    Keyboard.dismiss()
    onOpenProfile(accountId)
  }

  function closeSearch() {
    Keyboard.dismiss()
    onViewChange({ ...view, searchOpen: false, query: '' })
  }

  return (
    <View style={[surface, styles.panel]} testID="social-rider-panel">
      <View style={styles.header}>
        <View style={styles.tabArea}>
          <View
            pointerEvents={searchOpen ? 'none' : 'auto'}
            accessibilityElementsHidden={searchOpen}
            importantForAccessibility={searchOpen ? 'no-hide-descendants' : 'auto'}
            style={searchOpen ? styles.coveredTabs : undefined}
          >
            <PillSelector
              activeId={tab}
              contained
              fitContent
              showFullLabel
              variant="lightTabs"
              style={styles.tabs}
            >
              <PillSelectorItem
                id="nearby"
                label="Nearby"
                icon={UsersThreeIcon}
                activeWidth={120}
                inactiveWidth={60}
                color={theme.palette.groupRide}
                badge={
                  nearbyCount > 0 ? (
                    <Text style={[styles.count, { color: theme.palette.green.text }]}>
                      {nearbyCount}
                    </Text>
                  ) : null
                }
                onPress={() => onViewChange({ ...view, tab: 'nearby' })}
              />
              <PillSelectorItem
                id="friends"
                label="Friends"
                icon={UsersIcon}
                activeWidth={120}
                inactiveWidth={60}
                color={theme.palette.blue}
                badge={
                  signedIn && friendBadgeCount > 0 ? (
                    <Text style={[styles.count, { color: friendBadgeColor.text }]}>
                      {friendBadgeCount}
                    </Text>
                  ) : null
                }
                indicatorColor={signedIn && incomingRequestCount > 0 ? requestDotColor : undefined}
                onPress={() => onViewChange({ ...view, tab: 'friends' })}
              />
            </PillSelector>
          </View>
          {searchOpen ? (
            <SearchInput
              autoFocus={signedIn}
              editable={signedIn}
              style={StyleSheet.absoluteFill}
              value={signedIn ? query : ''}
              onChangeText={(text) => onViewChange({ ...view, query: text })}
              placeholder="Find riders by nick"
              testID="rider-search"
            />
          ) : null}
        </View>
        <IconButton
          size="sm"
          icon={searchOpen ? XIcon : MagnifyingGlassIcon}
          accessibilityLabel={searchOpen ? 'Close rider search' : 'Search riders'}
          testID={searchOpen ? 'social-search-close' : 'social-search-tab'}
          onPress={searchOpen ? closeSearch : () => onViewChange({ ...view, searchOpen: true })}
        />
      </View>
      {!searchOpen && tab === 'nearby' ? (
        <NearbyRiders
          rows={rows}
          ownLocation={ownLocation}
          live={live}
          ownProfile={ownProfile}
          onOpenRider={openRider}
          onShowOnMap={onNavigate}
        />
      ) : !signedIn ? (
        <SocialFriendsSignIn search={searchOpen} />
      ) : searchOpen ? (
        <SocialRiderSearchResults query={query} onOpenRider={openRider} />
      ) : (
        <SocialFriendLists
          onSearch={() => onViewChange({ ...view, searchOpen: true })}
          onOpenRider={openRider}
          renderRidingFriend={(friend, divided) => {
            const row = rows.find(
              (rider) => rider.id === friend.accountId && !rider.stale && rider.presence,
            )
            return row ? (
              <RosterList
                key={row.id}
                rows={[row]}
                ownLocation={ownLocation}
                compact
                divided={divided}
                onOpenRider={() => openRider(row.id)}
              />
            ) : null
          }}
        />
      )}
    </View>
  )
}

function NearbyRiders({
  rows,
  ownLocation,
  live,
  ownProfile,
  onOpenRider,
  onShowOnMap,
}: {
  rows: RosterRider[]
  ownLocation: { lat: number; lng: number } | null
  live: boolean
  ownProfile: RiderProfile | null
  onOpenRider: (accountId: string) => void
  onShowOnMap?: () => void
}) {
  const selfReadings = useOwnRiderReadings(live)
  const firstOnMap = rows.find((row) => row.presence)
  const self: RosterRider = {
    id: 'nearby:self',
    name: ownProfile?.nick ?? 'Rider',
    presence: null,
    trail: null,
    stale: false,
    away: false,
    lastSeen: 0,
    isSelf: true,
  }
  const visibleRows = live ? [self, ...rows] : rows

  return (
    <View style={styles.nearby} testID="nearby-riders">
      {visibleRows.length ? (
        <RosterList
          rows={visibleRows}
          ownLocation={ownLocation}
          compact
          onOpenRider={(rider) => {
            const accountId = rider.isSelf ? ownProfile?.accountId : rider.id
            if (accountId) onOpenRider(accountId)
          }}
          selfCanOpen={ownProfile !== null}
          selfReadings={selfReadings}
        />
      ) : (
        <Placeholder
          compact
          icon={CrosshairIcon}
          title="No riders nearby"
          description="Riders sharing their location will show up here."
        />
      )}
      {rows.length >= NEARBY_RIDER_LIMIT ? (
        <Text style={styles.notice}>Showing the nearest {NEARBY_RIDER_LIMIT}.</Text>
      ) : null}
      {firstOnMap && onShowOnMap ? (
        <Button
          label="Show on map"
          icon={MapTrifoldIcon}
          variant="groupRide"
          size="sm"
          style={styles.map}
          onPress={() => {
            useGroupRideStore.getState().focusRider(firstOnMap.id)
            onShowOnMap()
          }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { padding: 12, gap: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tabArea: { flex: 1, minWidth: 0, minHeight: 40, justifyContent: 'center' },
  coveredTabs: { opacity: 0 },
  tabs: { maxWidth: '100%' },
  nearby: { gap: 8 },
  count: { fontSize: 10 },
  notice: { color: theme.neutral.textSecondary, fontSize: 12, lineHeight: 17 },
  map: { alignSelf: 'flex-end' },
})
