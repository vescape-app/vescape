import { useState } from 'react'
import { Keyboard, StyleSheet, View } from 'react-native'
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
import { NEARBY_RIDER_LIMIT, type RosterRider } from '@/modules/group-ride/lib/roster'
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

type Tab = 'nearby' | 'friends'

export function SocialRiderPanel({ onNavigate }: { onNavigate?: () => void }) {
  const [tab, setTab] = useState<Tab>('nearby')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const signedIn = useDeviceAccountReady()
  const nearbyCount = useGroupRideStore((s) => s.rosterRows.length + Number(s.publicRide.live))
  const friendCount = useFriendsStore((s) => s.lists.friends.length)
  const surface = useResolvedSecondaryWidgetSurface()

  function closeSearch() {
    Keyboard.dismiss()
    setQuery('')
    setSearchOpen(false)
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
                activeWidth={98}
                color={theme.palette.groupRide}
                badge={<Text style={styles.count}>{nearbyCount}</Text>}
                onPress={() => setTab('nearby')}
              />
              <PillSelectorItem
                id="friends"
                label="Friends"
                icon={UsersIcon}
                activeWidth={98}
                color={theme.palette.blue}
                badge={<Text style={styles.count}>{signedIn ? friendCount : 0}</Text>}
                onPress={() => setTab('friends')}
              />
            </PillSelector>
          </View>
          {searchOpen ? (
            <SearchInput
              autoFocus={signedIn}
              editable={signedIn}
              style={StyleSheet.absoluteFill}
              value={signedIn ? query : ''}
              onChangeText={setQuery}
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
          onPress={searchOpen ? closeSearch : () => setSearchOpen(true)}
        />
      </View>
      {!searchOpen && tab === 'nearby' ? (
        <NearbyRiders onShowOnMap={onNavigate} />
      ) : !signedIn ? (
        <SocialFriendsSignIn search={searchOpen} />
      ) : searchOpen ? (
        <SocialRiderSearchResults query={query} />
      ) : (
        <SocialFriendLists onSearch={() => setSearchOpen(true)} />
      )}
    </View>
  )
}

function NearbyRiders({ onShowOnMap }: { onShowOnMap?: () => void }) {
  const rows = useGroupRideStore((s) => s.rosterRows)
  const ownLocation = useGroupRideStore((s) => s.ownLocation)
  const live = useGroupRideStore((s) => s.publicRide.live)
  const nick = useRiderProfileStore((s) => s.profile?.nick)
  const firstOnMap = rows.find((row) => row.presence)
  const self: RosterRider = {
    id: 'nearby:self',
    name: nick ?? 'You',
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
        <RosterList rows={visibleRows} ownLocation={ownLocation} compact />
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
  panel: { padding: 12, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tabArea: { flex: 1, minWidth: 0, minHeight: 40, justifyContent: 'center' },
  coveredTabs: { opacity: 0 },
  tabs: { maxWidth: '100%' },
  nearby: { gap: 8 },
  count: { color: theme.control.textMuted, fontSize: 10 },
  notice: { color: theme.neutral.textSecondary, fontSize: 12, lineHeight: 17 },
  map: { alignSelf: 'flex-end' },
})
