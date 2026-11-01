import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  CalendarBlankIcon,
  ClockIcon,
  BatteryMediumIcon,
  CaretRightIcon,
  MapTrifoldIcon,
  GaugeIcon,
  UserCircleIcon,
  UsersThreeIcon,
  UsersIcon,
  ShieldCheckIcon,
} from 'phosphor-react-native'
import { useRouter } from 'expo-router'
import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { Text } from '@/components/base/Text'
import { IconButton } from '@/components/base/IconButton'
import { Switch } from '@/components/controls/Switch'
import { Button } from '@/components/base/Button'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { theme } from '@/constants/theme'
import { MOCK_RIDERS, publicRidePageRider, type MockRider } from './fixtures'
import { usePublicRidePrototypeStore } from './prototypeStore'
import { InactiveFriends, AddFriendButton } from './PrototypeFriends'
import { SocialPageStack } from './SocialPageStack'
import { PublicRideSelector } from './PublicRideSelector'
import { RiderProfileDetail } from './RiderProfileDetail'

interface Props {
  identity: ReactNode
  page: string
  onPageChange: (page: string) => void
  onShowOnMap?: () => void
}

/** Development-only UI sandbox. No sharing intents, permissions, timers, or persisted settings. */
export function PublicRidePrototype({ identity, page, onPageChange, onShowOnMap }: Props) {
  useRenderRateWarning('PublicRidePrototype')
  const router = useRouter()
  const [hourly, setHourly] = useState(true)
  const hours = usePublicRidePrototypeStore((state) => state.hours)
  const [tab, setTab] = useState<'nearby' | 'friends'>('nearby')
  const mode = usePublicRidePrototypeStore((state) => state.mode)
  const setMode = usePublicRidePrototypeStore((state) => state.setMode)
  const inactiveFriends = usePublicRidePrototypeStore((state) => state.inactiveFriends)
  const selected = publicRidePageRider(page, inactiveFriends)
  const hidden = usePublicRidePrototypeStore((state) => state.hidden)
  const setHidden = usePublicRidePrototypeStore((state) => state.setHidden)
  const surface = useResolvedSecondaryWidgetSurface()
  const neutral = useResolvedNeutralColors()
  const riders = mode === 'off' ? [] : MOCK_RIDERS.filter((rider) => !hidden.includes(rider.id))
  const friends = riders.filter((rider) => rider.friend)
  const visibleRiders = tab === 'friends' ? friends : riders
  const ridingFriends = friends.filter(
    (rider) => rider.freshness === 'live' && (rider.speed ?? 0) > 0,
  )
  const navigate = (rider: MockRider | null) => {
    onPageChange(rider?.id ?? 'nearby')
  }

  return (
    <View testID="public-ride-prototype">
      <SocialPageStack page={page} detail={selected !== null}>
        {selected ? (
          <RiderProfileDetail
            key={selected.id}
            rider={selected}
            onShowOnMap={() => {
              usePublicRidePrototypeStore.getState().requestMap([selected.id], true)
              onShowOnMap?.()
            }}
          />
        ) : (
          <>
            <PublicRideSelector
              value={mode}
              hours={hourly ? hours : undefined}
              onValueChange={setMode}
              durationControl={
                <View style={styles.durationSwitch}>
                  <Switch
                    onIcon={ClockIcon}
                    offIcon={CalendarBlankIcon}
                    value={hourly}
                    accent={theme.palette.groupRide.color}
                    accessibilityLabel="Choose duration with hours instead of ride and day presets"
                    onValueChange={(next) => {
                      setHourly(next)
                      if (mode !== 'off' && mode !== 'automatic') setMode(next ? 'hours' : 'ride')
                    }}
                  />
                </View>
              }
              profileAction={
                <View>
                  {identity}
                  {mode !== 'off' ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.profileDot,
                        {
                          backgroundColor: theme.palette.groupRide.color,
                        },
                      ]}
                    />
                  ) : null}
                </View>
              }
            />
            <View style={[surface, styles.roster]}>
              <View style={styles.rosterHeader}>
                <PillSelector activeId={tab} contained fitContent showFullLabel variant="lightTabs">
                  <PillSelectorItem
                    id="nearby"
                    label="Nearby"
                    icon={UsersThreeIcon}
                    activeWidth={120}
                    inactiveWidth={60}
                    color={theme.palette.groupRide}
                    badge={<Text style={styles.count}>{riders.length}</Text>}
                    onPress={() => setTab('nearby')}
                  />
                  <PillSelectorItem
                    id="friends"
                    label="Friends"
                    icon={UsersIcon}
                    activeWidth={120}
                    inactiveWidth={60}
                    color={theme.palette.blue}
                    badge={<Text style={styles.count}>{ridingFriends.length}</Text>}
                    onPress={() => setTab('friends')}
                  />
                </PillSelector>
                <IconButton
                  icon={ShieldCheckIcon}
                  accessibilityLabel="Privacy zones"
                  onPress={() => router.push('/settings/privacy-zones')}
                />
              </View>
              <View>
                {visibleRiders.length ? (
                  visibleRiders.map((rider, index) => (
                    <Pressable
                      key={rider.id}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${rider.name}, battery ${reading(rider.battery, '%')}, ${speed(rider)}, ${rider.distance}, ${rider.freshness === 'live' ? 'Live' : `Last seen ${rider.age}`}`}
                      onPress={() => navigate(rider)}
                      style={[
                        styles.rider,
                        index > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: neutral.border,
                        },
                      ]}
                    >
                      <Avatar rider={rider} />
                      <Text numberOfLines={1} style={[styles.name, styles.riderName]}>
                        {rider.name}
                      </Text>
                      <View style={[styles.telemetry, styles.flex]}>
                        {rider.battery !== null ? (
                          <>
                            <BatteryMediumIcon size={16} color={theme.palette.groupRide.color} />
                            <Text style={styles.caption}>{reading(rider.battery, '%')}</Text>
                          </>
                        ) : null}
                        <GaugeIcon size={14} color={theme.neutral.textSecondary} />
                        <Text numberOfLines={1} style={styles.caption}>
                          {rider.board ? speed(rider) : 'Disconnected'}
                        </Text>
                      </View>
                      <Text style={styles.distance}>{rider.distance}</Text>
                      <CaretRightIcon size={14} color={theme.neutral.textSecondary} />
                    </Pressable>
                  ))
                ) : tab === 'nearby' ? (
                  <Text style={[styles.secondary, styles.empty]}>
                    {mode === 'off'
                      ? 'Choose a public ride mode to see nearby riders.'
                      : 'No riders nearby right now.'}
                  </Text>
                ) : null}
                {tab === 'friends' ? (
                  <InactiveFriends
                    followsActive={visibleRiders.length > 0}
                    onSelect={onPageChange}
                  />
                ) : null}
              </View>
              {tab === 'friends' ? (
                <AddFriendButton />
              ) : (
                <Button
                  label="Show on map"
                  icon={MapTrifoldIcon}
                  variant="groupRide"
                  size="sm"
                  style={styles.showOnMap}
                  disabled={!visibleRiders.length}
                  onPress={() => {
                    usePublicRidePrototypeStore
                      .getState()
                      .requestMap(visibleRiders.map((rider) => rider.id))
                    onShowOnMap?.()
                  }}
                />
              )}
            </View>
          </>
        )}
        {!selected && hidden.length ? (
          <Button
            label="Reset simulated riders"
            variant="secondary"
            onPress={() => setHidden([])}
          />
        ) : null}
      </SocialPageStack>
    </View>
  )
}

function reading(value: number | null, suffix: string) {
  return value === null ? '—' : `${value}${suffix}`
}
function speed(rider: MockRider) {
  return rider.speed === 0 ? 'Stopped' : reading(rider.speed, ' km/h')
}
function Dot({ recent = false }: { recent?: boolean }) {
  return (
    <View
      style={[
        styles.dot,
        { backgroundColor: recent ? theme.palette.amber.color : theme.palette.groupRide.color },
      ]}
    />
  )
}
function Avatar({ rider, large = false }: { rider: MockRider; large?: boolean }) {
  return (
    <View accessible={false}>
      <UserCircleIcon size={large ? 64 : 32} color={theme.neutral.textSecondary} weight="thin" />
      <View style={styles.avatarDot}>
        <Dot recent={rider.freshness === 'recent'} />
      </View>
    </View>
  )
}
const styles = StyleSheet.create({
  durationSwitch: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roster: { padding: 12, gap: 6 },
  showOnMap: { alignSelf: 'flex-end', marginTop: 4 },
  rosterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  profileDot: {
    position: 'absolute',
    left: 1,
    top: 1,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  flex: { flex: 1, minWidth: 0 },
  count: { color: theme.control.textMuted, fontSize: 10, marginLeft: 5 },
  riderName: { width: 48, fontSize: 13 },
  distance: { color: theme.neutral.textSecondary, fontSize: 12, width: 56, textAlign: 'center' },
  name: { color: theme.neutral.textPrimary, fontSize: 15, fontWeight: '700' },
  secondary: { color: theme.neutral.textSecondary, fontSize: 13, lineHeight: 20 },
  caption: { color: theme.neutral.textSecondary, fontSize: 11, lineHeight: 17, flexShrink: 1 },
  rider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 8,
    minHeight: 48,
  },
  telemetry: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  avatarDot: { position: 'absolute', top: 1, left: 1 },
  empty: { paddingVertical: 20 },
})
