/** Boxed public rider profile, shared by Social and the design studies. */
import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BatteryMediumIcon,
  BroadcastIcon,
  ChartBarIcon,
  CircleIcon,
  ClockIcon,
  GaugeIcon,
  MapPinIcon,
  MapTrifoldIcon,
  NavigationArrowIcon,
  RoadHorizonIcon,
  StackIcon,
  PathIcon,
  TimerIcon,
  LightningIcon,
  CpuIcon,
  ThermometerIcon,
  DeviceMobileIcon,
} from 'phosphor-react-native'
import { SectionHeader } from '@/components/base/SectionHeader'
import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { BoardModelPreview } from '@/modules/board/components/BoardModelPreview'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

export function RiderProfileSections({
  variant,
  active,
  identity,
  rider,
  boards,
  showControls = false,
  onShowOnMap,
}: {
  variant: number
  active: boolean
  identity: ReactNode
  rider: {
    name: string
    board: string | null
    freshness: string
    age: string
    distance: string
    speed: number | null
    battery: number | null
    rideDistance: number | null
    voltage: number | null
    controller: number | null
    phone?: number | null
    motor: number | null
  }
  boards: readonly {
    name: string
    rail: string
    color: string
    colorName: string
    railName: string
    battery: string
    capacity: string
    distance: string
  }[]
  showControls?: boolean
  onShowOnMap?: () => void
}) {
  const n = useResolvedNeutralColors()
  const rideStatus = ridePresentation(rider.freshness)
  const RideStatusIcon = rideStatus.icon
  const [boardIndex, setBoardIndex] = useState(0)
  const [statsOpen, setStatsOpen] = useState(false)
  const [destination, setDestination] = useState(true)
  const [navigation, setNavigation] = useState(false)
  const board = boards[boardIndex]!
  const reading = (value: number | null | undefined, suffix = '') =>
    value == null ? '—' : `${value}${suffix}`
  const box = (children: ReactNode) => (
    <View style={[s.box, { backgroundColor: n.surface, borderColor: n.border }]}>{children}</View>
  )
  const info = (label: string, value: string) => (
    <View style={s.info}>
      <Text style={s.muted}>{label}</Text>
      <Text style={s.body}>{value}</Text>
    </View>
  )
  const stats = (
    <View style={s.section}>
      <SectionHeader title="Riding stats" icon={ChartBarIcon} color={theme.palette.purple.color} />
      {box(
        <>
          <View style={s.row}>
            {[
              {
                icon: RoadHorizonIcon,
                value: '2,284 km',
                label: 'Distance',
                color: theme.palette.sky.color,
              },
              { icon: PathIcon, value: '146', label: 'Rides', color: theme.palette.cyan.color },
              {
                icon: TimerIcon,
                value: '182 h',
                label: 'Ride time',
                color: theme.palette.purple.color,
              },
            ].map(({ icon: Glyph, value, label, color }) => (
              <View key={label} style={s.flex}>
                <Glyph size={18} color={color} />
                <Text style={s.statsValue}>{value}</Text>
                <Text style={s.muted}>{label}</Text>
              </View>
            ))}
          </View>
          <View style={s.row}>
            <Text style={[s.muted, s.flex]}>All time · {boards.length} boards</Text>
            <Button
              label={statsOpen ? 'Close stats' : 'View stats'}
              icon={ChartBarIcon}
              size="sm"
              variant="secondary"
              onPress={() => setStatsOpen(!statsOpen)}
            />
          </View>
          {statsOpen && (
            <>
              <Text style={s.eyebrow}>MONTHLY DISTANCE · SAMPLE DATA</Text>
              <View style={s.chart}>
                {[52, 78, 43, 95, 65, 85].map((height, i) => (
                  <View key={i} style={s.barColumn}>
                    <View
                      style={[
                        s.bar,
                        {
                          height,
                          borderColor: theme.palette.sky.color,
                          backgroundColor: theme.palette.sky.bg,
                        },
                      ]}
                    />
                    <Text style={s.tiny}>{['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'][i]}</Text>
                  </View>
                ))}
              </View>
              <View style={s.row}>
                {info('Longest ride', '42.6 km')}
                {info('This month', '184 km')}
              </View>
            </>
          )}
        </>,
      )}
    </View>
  )
  const garage = (
    <View style={s.section}>
      <SectionHeader title="Boards" icon={StackIcon} color={theme.palette.cyan.color} />
      {box(
        <>
          <View style={s.row}>
            <View style={s.flex}>
              <Text style={s.eyebrow}>{board.railName}</Text>
              <Text style={s.title}>{board.name}</Text>
            </View>
            <Text style={s.muted}>
              {boardIndex + 1} / {boards.length}
            </Text>
          </View>
          <View style={s.boardRow}>
            <IconButton
              icon={ArrowLeftIcon}
              accessibilityLabel="Previous board"
              onPress={() => {
                setBoardIndex((boardIndex - 1 + boards.length) % boards.length)
              }}
            />
            <View style={s.model}>
              <BoardModelPreview
                size={172}
                railId={board.rail}
                railColorId={board.color}
                rollDegrees={20}
              />
            </View>
            <IconButton
              icon={ArrowRightIcon}
              accessibilityLabel="Next board"
              onPress={() => {
                setBoardIndex((boardIndex + 1) % boards.length)
              }}
            />
          </View>
          <View style={s.row}>
            {info('Battery', board.capacity)}
            {info('Pack', board.battery)}
            {info('Total distance', board.distance)}
          </View>
        </>,
      )}
    </View>
  )
  const journey = (
    <View style={s.journey}>
      <View style={[s.line, { backgroundColor: n.border }]} />
      <View style={s.stop}>
        <CircleIcon size={18} color={theme.palette.purple.color} />
        <View style={s.flex}>
          <Text style={s.body}>Saska Kępa</Text>
          <Text style={s.muted}>Started at 10:02</Text>
        </View>
      </View>
      <View style={s.stop}>
        <View style={[s.current, { borderColor: rideStatus.color }]}>
          <View style={[s.currentDot, { backgroundColor: rideStatus.color }]} />
        </View>
        <View style={s.flex}>
          <Text style={s.body}>Skaryszewski Park</Text>
          <Text style={s.muted}>
            {rider.freshness === 'live' ? 'Current location' : 'Last known location'} ·{' '}
            {rider.distance} from you
          </Text>
        </View>
        {onShowOnMap && rider.freshness === 'live' ? (
          <Button
            label="Show on map"
            icon={MapTrifoldIcon}
            size="sm"
            variant="secondary"
            onPress={onShowOnMap}
          />
        ) : null}
      </View>
      {destination && (
        <View style={s.stop}>
          <MapPinIcon size={20} color={theme.palette.cyan.color} />
          <View style={s.flex}>
            <Text style={s.body}>Poniatowski Bridge</Text>
            <Text style={s.muted}>Direction Point · 2.8 km from {rider.name}</Text>
          </View>
          <Button
            label={navigation ? 'Close' : 'Navigate'}
            icon={NavigationArrowIcon}
            size="sm"
            variant="accent"
            onPress={() => setNavigation(!navigation)}
          />
        </View>
      )}
    </View>
  )
  const live = active ? (
    <View style={s.section}>
      <SectionHeader title={rideStatus.title} icon={RideStatusIcon} color={rideStatus.color} />
      {box(
        <>
          <View style={s.row}>
            <View style={s.flex}>
              <Text style={s.title}>{rider.board ?? 'Board disconnected'}</Text>
              <Text style={s.muted}>
                {rider.freshness === 'live' ? 'Live' : 'Last known readings'} · updated {rider.age}
              </Text>
            </View>
            <BoardModelPreview size={58} railId="adv" railColorId="purple" />
          </View>
          <View style={s.metrics}>
            {[
              {
                icon: GaugeIcon,
                value: reading(rider.speed, ' km/h'),
                label: 'Speed',
                color: theme.telemetry.speed,
              },
              {
                icon: BatteryMediumIcon,
                value: reading(rider.battery, '%'),
                label: 'Battery',
                color: theme.palette.green.color,
              },
              {
                icon: RoadHorizonIcon,
                value: reading(rider.rideDistance, ' km'),
                label: 'Distance',
                color: theme.palette.sky.color,
              },
              {
                icon: TimerIcon,
                value: '18 min',
                label: 'Ride time',
                color: theme.palette.purple.color,
              },
              {
                icon: LightningIcon,
                value: reading(rider.voltage, ' V'),
                label: 'Voltage',
                color: theme.palette.amber.color,
              },
              {
                icon: CpuIcon,
                value: reading(rider.controller, '°C'),
                label: 'Controller',
                color: theme.telemetry.controllerTemp,
              },
              {
                icon: ThermometerIcon,
                value: reading(rider.motor, '°C'),
                label: 'Motor',
                color: theme.telemetry.motorTemp,
              },
              {
                icon: DeviceMobileIcon,
                value: reading(rider.phone, '%'),
                label: 'Phone',
                color: theme.palette.cyan.color,
              },
            ].map(({ icon: Glyph, value, label, color }) => (
              <View key={label} style={s.metric}>
                <Glyph size={18} color={color} />
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={s.metricValue}
                >
                  {value}
                </Text>
                <Text style={s.muted}>{label}</Text>
              </View>
            ))}
          </View>
          {rider.freshness === 'live' ? journey : null}
          {navigation && destination && rider.freshness === 'live' && (
            <View style={[s.routePreview, { borderColor: n.border }]}>
              <Text style={s.eyebrow}>ROUTE PREVIEW · SIMULATED</Text>
              <Text style={s.title}>You → Poniatowski Bridge</Text>
              <Text style={s.muted}>3.6 km · about 14 min · same destination as {rider.name}</Text>
              <Text style={s.muted}>No real navigation started.</Text>
            </View>
          )}
        </>,
      )}
    </View>
  ) : null

  return (
    <View style={s.section}>
      {box(identity)}
      {variant === 0 && (
        <>
          {stats}
          {live}
          {garage}
        </>
      )}
      {variant === 1 && (
        <ProfileTabs
          active={active}
          name={rider.name}
          garage={garage}
          stats={stats}
          live={live}
          box={box}
        />
      )}
      {variant === 2 && (
        <>
          {live}
          {garage}
          {stats}
        </>
      )}
      {showControls &&
        active &&
        box(
          <View style={s.row}>
            <Text style={[s.muted, s.flex]}>Prototype controls</Text>
            <Button
              label={destination ? 'Point: on' : 'Point: off'}
              size="sm"
              variant="secondary"
              icon={MapPinIcon}
              onPress={() => {
                setDestination(!destination)
                setNavigation(false)
              }}
            />
          </View>,
        )}
    </View>
  )
}
function ridePresentation(freshness: string) {
  return freshness === 'live'
    ? {
        title: 'Live ride',
        icon: BroadcastIcon,
        color: theme.palette.green.color,
      }
    : {
        title: 'Last known ride',
        icon: ClockIcon,
        color: theme.palette.amber.color,
      }
}

function ProfileTabs({
  active,
  name,
  garage,
  stats,
  live,
  box,
}: {
  active: boolean
  name: string
  garage: ReactNode
  stats: ReactNode
  live: ReactNode
  box: (children: ReactNode) => ReactNode
}) {
  const [tab, setTab] = useState<'profile' | 'live'>('profile')
  return (
    <>
      <View style={s.row}>
        <Button
          label="Profile"
          variant={tab === 'profile' ? 'accent' : 'secondary'}
          style={s.flex}
          onPress={() => setTab('profile')}
        />
        <Button
          label={active ? 'Live ride' : 'Live · offline'}
          variant={tab === 'live' ? 'accent' : 'secondary'}
          style={s.flex}
          onPress={() => setTab('live')}
        />
      </View>
      {tab === 'profile' ? (
        <>
          {garage}
          {stats}
        </>
      ) : active ? (
        live
      ) : (
        box(
          <>
            <Text style={s.title}>No live ride</Text>
            <Text style={s.muted}>
              {name}’s boards and riding stats are still available on this profile.
            </Text>
            <Button
              label="Back to profile"
              size="sm"
              variant="secondary"
              onPress={() => setTab('profile')}
            />
          </>,
        )
      )}
    </>
  )
}

const s = StyleSheet.create({
  section: { gap: 14 },
  box: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '700', color: theme.neutral.textPrimary },
  body: { fontSize: 13, fontWeight: '600', color: theme.neutral.textPrimary },
  muted: { fontSize: 11, lineHeight: 17, color: theme.neutral.textSecondary, flexShrink: 1 },
  tiny: { fontSize: 9, color: theme.neutral.textSecondary },
  eyebrow: { fontSize: 9, letterSpacing: 1, color: theme.neutral.textMuted, marginBottom: 4 },
  number: {
    fontFamily: theme.mono('700'),
    fontSize: 24,
    color: theme.neutral.textPrimary,
    marginVertical: 5,
  },
  statsValue: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.neutral.textPrimary,
    marginTop: 8,
    marginBottom: 4,
  },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 18 },
  metric: { width: '25%', paddingRight: 6 },
  metricValue: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.neutral.textPrimary,
    marginTop: 8,
    marginBottom: 4,
  },
  info: { flex: 1, gap: 4 },
  boardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  model: {
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    flex: 1,
  },
  journey: { gap: 18, paddingVertical: 4 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { position: 'absolute', width: 1, top: 20, bottom: 22, left: 9 },
  current: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.neutral.surface,
  },
  currentDot: { width: 5, height: 5, borderRadius: 3 },
  routePreview: { borderTopWidth: 1, paddingTop: 12, gap: 6 },
  chart: { height: 115, flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  barColumn: { flex: 1, alignItems: 'center', gap: 5 },
  bar: { width: '100%', borderWidth: 1, borderRadius: 4 },
})
