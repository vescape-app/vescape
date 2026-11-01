/** Throwaway: nine English rider profiles. Fixtures and friendship actions stay in memory. */
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BatteryMediumIcon,
  BroadcastIcon,
  CheckIcon,
  ClockIcon,
  MapPinIcon,
  MapTrifoldIcon,
  RoadHorizonIcon,
  DeviceMobileIcon,
  UserCircleIcon,
  UserPlusIcon,
  UsersIcon,
  NavigationArrowIcon,
} from 'phosphor-react-native'
import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { BoardModelPreview } from '@/modules/board/components/BoardModelPreview'
import { SocialDrawerHeader } from '@/modules/group-ride/components/public-ride-prototype/SocialDrawerHeader'
import { ProfileSectionsPrototype } from './ProfileSectionsPrototype'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

import {
  s,
  speed,
  battery,
  distance,
  duration,
  voltage,
  controller,
  motor,
  phone,
  Readout,
  PreviewMap,
  type Metric,
} from './riderProfileStudyParts'

const names = [
  'Ride card',
  'Board focus',
  'Nearby',
  'Telemetry',
  'Ride story',
  'Essentials',
  'Profile overview',
  'Profile & Live tabs',
  'Ride & garage',
]

function useRiderProfileStudy() {
  const params = useLocalSearchParams<{ variant?: string }>()
  const parsed = Number(params.variant || 7)
  const index = Number.isFinite(parsed)
    ? Math.max(0, Math.min(names.length - 1, Math.trunc(parsed) - 1))
    : 0
  const router = useRouter()
  const n = useResolvedNeutralColors()
  const [active, setActive] = useState(true)
  const [friend, setFriend] = useState(false)
  const [sent, setSent] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const change = (delta: number) => {
    setMapOpen(false)
    setExpanded(false)
    router.setParams({ variant: String(((index + delta + names.length) % names.length) + 1) })
  }
  const friendship =
    friend || sent ? (
      <View style={s.inline}>
        <CheckIcon
          size={15}
          color={friend ? theme.palette.purple.color : theme.neutral.textMuted}
        />
        <Text style={s.caption}>{friend ? 'Friends' : 'Requested'}</Text>
      </View>
    ) : (
      <Button
        label="Add friend"
        icon={UserPlusIcon}
        variant="secondary"
        size="sm"
        onPress={() => setSent(true)}
      />
    )
  const status = (
    <View style={s.inline}>
      {active ? (
        <BroadcastIcon size={14} color={theme.palette.green.color} />
      ) : (
        <ClockIcon size={14} color={theme.palette.amber.color} />
      )}
      <Text
        style={[s.caption, { color: active ? theme.palette.green.text : theme.palette.amber.text }]}
      >
        {active ? 'Live · updated 3s ago' : 'Offline · last seen 2h ago'}
      </Text>
    </View>
  )
  const identity = (
    <View style={s.identity}>
      <UserCircleIcon size={46} color={theme.neutral.textSecondary} weight="thin" />
      <View style={s.flex}>
        <Text style={s.name}>Maja</Text>
        {status}
      </View>
      {friendship}
    </View>
  )
  const board = (
    <View style={s.board}>
      <BoardModelPreview size={72} />
      <View style={s.flex}>
        <Text style={s.eyebrow}>{active ? 'RIDING' : 'BOARD'}</Text>
        <Text style={s.boardName}>Floatwheel ADV2</Text>
        <Text style={s.small}>Custom rails</Text>
      </View>
    </View>
  )
  const section = (title: string) => <Text style={s.eyebrow}>{title}</Text>
  const line = <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: n.border }} />
  const stats = (items: Metric[], compact = false) => (
    <View style={s.stats}>
      {items.map((item) => (
        <Readout key={item.label} item={item} active={active} compact={compact} />
      ))}
    </View>
  )
  const rows = (items: Metric[]) => (
    <View>
      {items.map((item) => (
        <Readout key={item.label} item={item} active={active} row />
      ))}
    </View>
  )
  const details = (
    <>
      {section(active ? 'BOARD & PHONE' : 'NO LIVE TELEMETRY')}
      {stats([voltage, controller, motor], true)}
      <View style={s.inline}>
        <DeviceMobileIcon size={14} color={theme.palette.purple.color} />
        <Text style={s.caption}>Phone charge</Text>
        <Text style={s.caption}>{active ? '81%' : 'Unavailable'}</Text>
      </View>
    </>
  )
  const proximity = (
    <View style={s.inline}>
      <MapPinIcon size={18} color={theme.palette.cyan.color} />
      <Text style={s.body}>{active ? '1.2 km away' : 'Last location · 2h ago'}</Text>
      <Text style={s.caption}>· Skaryszewski Park</Text>
    </View>
  )
  const action = (
    <Button
      label={mapOpen ? 'Back to profile' : active ? 'Show on map' : 'Show last location'}
      icon={MapTrifoldIcon}
      variant="accent"
      onPress={() => setMapOpen(!mapOpen)}
    />
  )
  const offline = !active && (
    <View style={s.offline}>
      <ClockIcon size={16} color={theme.palette.amber.color} />
      <Text style={[s.caption, s.flex]}>
        Location is from 2 hours ago. Live ride data is unavailable.
      </Text>
    </View>
  )

  return {
    n,
    router,
    index,
    active,
    friend,
    mapOpen,
    expanded,
    setMapOpen,
    setExpanded,
    setActive,
    setFriend,
    setSent,
    change,
    identity,
    status,
    friendship,
    board,
    section,
    line,
    stats,
    rows,
    details,
    proximity,
    action,
    offline,
  }
}

export default function RiderProfilePrototype() {
  const study = useRiderProfileStudy()
  const {
    n,
    router,
    index,
    active,
    friend,
    mapOpen,
    setActive,
    setFriend,
    setSent,
    change,
    identity,
    board,
    section,
    line,
    proximity,
    action,
    offline,
  } = study

  return (
    <SafeAreaView style={[s.root, { backgroundColor: n.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <SocialDrawerHeader
          riderName="Maja"
          onBack={() => router.back()}
          onClose={() => router.back()}
        />
      </View>
      {index >= 6 && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {[15, 45, 75].map((x) => (
            <View
              key={x}
              style={{
                position: 'absolute',
                left: `${x}%`,
                width: 3,
                height: '120%',
                backgroundColor: n.border,
                opacity: 0.3,
                transform: [{ rotate: '25deg' }],
              }}
            />
          ))}
        </View>
      )}
      <ScrollView key={`${index}-${mapOpen}`} contentContainerStyle={s.content}>
        {index >= 6 ? (
          <ProfileSectionsPrototype
            key={index}
            variant={index - 6}
            active={active}
            identity={identity}
          />
        ) : mapOpen ? (
          <>
            {identity}
            <PreviewMap active={active} large />
            {offline}
            {action}
          </>
        ) : !active ? (
          <>
            {identity}
            {line}
            {board}
            {section('LAST SHARED LOCATION')}
            {(index === 2 || index === 4) && <PreviewMap active={false} large />}
            {proximity}
            {offline}
            {action}
          </>
        ) : (
          <LegacyRideLayouts study={study} />
        )}
      </ScrollView>
      {__DEV__ && (
        <View style={[s.switcher, { backgroundColor: n.surface, borderColor: n.border }]}>
          <View style={s.inline}>
            <IconButton
              icon={ArrowLeftIcon}
              accessibilityLabel="Previous layout"
              onPress={() => change(-1)}
            />
            <View style={[s.flex, s.centeredLabel]}>
              <Text style={s.small}>
                PROFILE STUDIES · {index + 1} / {names.length}
              </Text>
              <Text style={s.boardName}>{names[index]}</Text>
            </View>
            <IconButton
              icon={ArrowRightIcon}
              accessibilityLabel="Next layout"
              onPress={() => change(1)}
            />
          </View>
          <View style={s.inline}>
            <Button
              label={active ? 'Live' : 'Offline'}
              size="sm"
              variant="secondary"
              icon={active ? BroadcastIcon : ClockIcon}
              style={s.flex}
              onPress={() => setActive(!active)}
            />
            <Button
              label={friend ? 'Friends' : 'Not friends'}
              size="sm"
              variant="secondary"
              icon={UsersIcon}
              style={s.flex}
              onPress={() => {
                setFriend(!friend)
                setSent(false)
              }}
            />
          </View>
          <Text style={[s.small, s.centeredLabel]}>Sample data · local actions only</Text>
        </View>
      )}
    </SafeAreaView>
  )
}

function LegacyRideLayouts({ study }: { study: ReturnType<typeof useRiderProfileStudy> }) {
  const {
    n,
    index,
    active,
    expanded,
    setExpanded,
    setMapOpen,
    identity,
    status,
    friendship,
    board,
    section,
    line,
    stats,
    rows,
    details,
    proximity,
    action,
    offline,
  } = study
  return (
    <>
      {index === 0 && (
        <>
          {identity}
          {line}
          {board}
          {stats([speed, battery, distance])}
          <View style={s.locationStrip}>{proximity}</View>
          {action}
          {line}
          {details}
        </>
      )}
      {index === 1 && (
        <>
          {identity}
          <View style={s.boardHero}>
            <View style={s.boardStage}>
              <BoardModelPreview size={174} rollDegrees={18} />
            </View>
            <Text style={s.heroBoard}>Floatwheel ADV2</Text>
            <Text style={s.caption}>Maja’s ride · Custom rails</Text>
          </View>
          <View style={[s.batteryLine, { borderColor: n.border }]}>
            <BatteryMediumIcon
              size={22}
              color={active ? theme.palette.green.color : theme.neutral.textMuted}
            />
            <Text style={s.body}>Board battery</Text>
            <View style={s.flex} />
            <Text style={s.mediumNumber}>
              {active ? '84' : '—'}
              <Text style={s.caption}> %</Text>
            </Text>
          </View>
          {stats([speed, distance, duration])}
          {action}
          {stats([voltage, controller, motor], true)}
          <Readout item={phone} active={active} row />
        </>
      )}
      {index === 2 && (
        <>
          {identity}
          <PreviewMap active={active} large />
          <View style={s.inline}>
            <View style={s.flex}>
              <Text style={s.mediumNumber}>{active ? '1.2 km' : '2h ago'}</Text>
              <Text style={s.caption}>{active ? 'away from you' : 'last known location'}</Text>
            </View>
            <Button
              label="Show on map"
              icon={NavigationArrowIcon}
              variant="accent"
              onPress={() => setMapOpen(true)}
            />
          </View>
          {line}
          {stats([speed, battery, distance], true)}
          {board}
          <Button
            label={expanded ? 'Hide board details' : 'Board details'}
            variant="secondary"
            size="sm"
            style={s.start}
            onPress={() => setExpanded(!expanded)}
          />
          {expanded && details}
        </>
      )}
      {index === 3 && (
        <>
          {identity}
          {proximity}
          {line}
          <View style={s.telemetryHeader}>
            <View style={s.flex}>
              <Text style={s.eyebrow}>CURRENT BOARD</Text>
              <Text style={s.boardName}>Floatwheel ADV2</Text>
              <Text style={s.small}>Custom rails</Text>
            </View>
            <BoardModelPreview size={90} />
          </View>
          {rows([speed, battery, distance])}
          {section('BOARD & PHONE')}
          <View style={s.twoColumns}>
            <View style={s.flex}>{rows([voltage, controller])}</View>
            <View style={s.flex}>{rows([motor, phone])}</View>
          </View>
          {action}
        </>
      )}
      {index === 4 && (
        <>
          {identity}
          {line}
          <View style={s.tripHeading}>
            <RoadHorizonIcon size={28} color={theme.palette.sky.color} />
            <View>
              <Text style={s.eyebrow}>{active ? 'TODAY’S RIDE' : 'LAST SHARED RIDE'}</Text>
              <View style={s.inline}>
                <Text style={s.tripNumber}>{active ? '3.2' : '—'}</Text>
                <Text style={s.body}>km</Text>
              </View>
            </View>
            <View style={s.flex} />
            <View>
              <Text style={s.mediumNumber}>
                {active ? '18' : '—'}
                <Text style={s.caption}> min</Text>
              </Text>
              <Text style={s.small}>ride time</Text>
            </View>
          </View>
          <View style={s.journey}>
            <View style={[s.journeyLine, { backgroundColor: n.border }]} />
            <View style={s.journeyStop}>
              <View style={[s.ring, { borderColor: theme.palette.purple.color }]} />
              <View>
                <Text style={s.body}>Saska Kępa</Text>
                <Text style={s.small}>{active ? 'Started at 10:02' : 'Start unavailable'}</Text>
              </View>
            </View>
            <View style={s.journeyStop}>
              <MapPinIcon
                size={22}
                color={active ? theme.palette.green.color : theme.palette.amber.color}
              />
              <View>
                <Text style={s.body}>Skaryszewski Park</Text>
                <Text style={s.small}>
                  {active ? 'Riding now · 1.2 km away' : 'Last seen 2 hours ago'}
                </Text>
              </View>
            </View>
          </View>
          {stats([speed, battery])}
          {board}
          {action}
          {line}
          {details}
        </>
      )}
      {index === 5 && (
        <>
          <View style={s.centered}>
            <UserCircleIcon size={68} color={theme.neutral.textSecondary} weight="thin" />
            <Text style={s.profileName}>Maja</Text>
            {status}
            {friendship}
          </View>
          <View style={s.minimalBoard}>
            <BoardModelPreview size={62} />
            <Text style={s.boardName}>Floatwheel ADV2</Text>
          </View>
          {line}
          {stats([speed, battery, distance], true)}
          {line}
          <View style={s.inline}>
            <MapPinIcon size={20} color={theme.palette.cyan.color} />
            <View style={s.flex}>
              <Text style={s.body}>{active ? '1.2 km away' : 'Last seen 2h ago'}</Text>
              <Text style={s.caption}>Skaryszewski Park</Text>
            </View>
            <IconButton
              icon={MapTrifoldIcon}
              accessibilityLabel="Show Maja on map"
              accent={theme.palette.cyan.color}
              onPress={() => setMapOpen(true)}
            />
          </View>
          <View style={s.inline}>
            <Text style={[s.caption, s.flex]}>Board & phone</Text>
            <Button
              label={expanded ? 'Less' : 'Details'}
              size="sm"
              variant="secondary"
              onPress={() => setExpanded(!expanded)}
            />
          </View>
          {expanded && rows([voltage, controller, motor, phone])}
        </>
      )}
      {offline}
    </>
  )
}
