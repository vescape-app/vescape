import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  BatteryMediumIcon,
  BroadcastIcon,
  CaretLeftIcon,
  CaretRightIcon,
  EyeSlashIcon,
  MapTrifoldIcon,
  GaugeIcon,
  UserCircleIcon,
  UsersThreeIcon,
} from 'phosphor-react-native'
import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { Switch } from '@/components/controls/Switch'
import { CanvasWidget } from '@/components/widgets/CanvasWidget'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { theme } from '@/constants/theme'
import { MOCK_RIDERS, PUBLIC_MODES, type MockRider } from './fixtures'
import { usePublicRidePrototypeStore } from './prototypeStore'
import { PublicRideSelector } from './PublicRideSelector'

interface Props {
  identity: ReactNode
  onPageChange?: (page: string) => void
}

/** Development-only UI sandbox. No sharing intents, permissions, timers, or persisted settings. */
export function PublicRidePrototype({ identity, onPageChange }: Props) {
  const mode = usePublicRidePrototypeStore((state) => state.mode)
  const setMode = usePublicRidePrototypeStore((state) => state.setMode)
  const [selected, setSelected] = useState<MockRider | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const showRidersOnMap = usePublicRidePrototypeStore((state) => state.showRidersOnMap)
  const setShowRidersOnMap = usePublicRidePrototypeStore((state) => state.setShowRidersOnMap)
  const hidden = usePublicRidePrototypeStore((state) => state.hidden)
  const setHidden = usePublicRidePrototypeStore((state) => state.setHidden)
  const surface = useResolvedSecondaryWidgetSurface()
  const neutral = useResolvedNeutralColors()
  const riders = mode === 'off' ? [] : MOCK_RIDERS.filter((rider) => !hidden.includes(rider.id))
  const navigate = (rider: MockRider | null, map = false) => {
    setSelected(rider)
    setMapOpen(map)
    onPageChange?.(map ? `map-${rider?.id ?? 'all'}` : (rider?.id ?? 'nearby'))
  }
  const goPrivate = () => {
    setMode('off')
    navigate(null)
  }

  return (
    <View style={styles.stack} testID="public-ride-prototype">
      <Text style={styles.caption}>UI prototype · simulated riders and locations</Text>
      {selected || mapOpen ? (
        <Button
          label="Nearby riders"
          icon={CaretLeftIcon}
          variant="secondary"
          onPress={() => navigate(null)}
        />
      ) : (
        identity
      )}
      {mapOpen ? (
        <CanvasWidget
          icon={MapTrifoldIcon}
          title={selected ? `${selected.name} on map` : 'Nearby riders'}
          surface="secondary"
        >
          <MockMap
            riders={selected ? [selected] : riders}
            onSelect={(rider) => navigate(rider)}
            expanded
          />
          {selected ? <Freshness rider={selected} /> : null}
        </CanvasWidget>
      ) : selected ? (
        <View style={[surface, styles.panel]} testID="public-rider-detail">
          <View style={styles.row}>
            <Avatar rider={selected} large />
            <View style={styles.flex}>
              <Text style={styles.nameLarge}>{selected.name}</Text>
              <Text style={styles.secondary}>{selected.board ?? 'Board disconnected'}</Text>
              <Freshness rider={selected} />
            </View>
          </View>
          <View style={styles.stats}>
            {[
              [reading(selected.battery, '%'), 'Board battery'],
              [speed(selected), 'Speed'],
              [reading(selected.rideDistance, ' km'), 'Ride distance'],
            ].map(([value, label]) => (
              <View key={label} style={styles.stat}>
                <Text style={styles.statValue}>{value}</Text>
                <Text style={styles.caption}>{label}</Text>
              </View>
            ))}
          </View>
          {selected.freshness === 'recent' ? (
            <Text style={styles.secondary}>Last known readings · {selected.updatedAt}</Text>
          ) : null}
          {[
            ['Distance from you', selected.distance],
            ['Board voltage', reading(selected.voltage, ' V')],
            ['Controller', reading(selected.controller, '°C')],
            ['Motor', reading(selected.motor, '°C')],
            ['Phone battery', reading(selected.phone, '%')],
          ].map(([label, value]) => (
            <View key={label} style={[styles.reading, { borderTopColor: neutral.border }]}>
              <Text style={styles.secondary}>{label}</Text>
              <Text style={styles.secondary}>{value}</Text>
            </View>
          ))}
          <MockMap riders={[selected]} />
          <Button
            label={
              selected.freshness === 'live' ? `Show ${selected.name} on map` : 'Show last location'
            }
            icon={MapTrifoldIcon}
            variant="accent"
            size="lg"
            onPress={() => navigate(selected, true)}
          />
        </View>
      ) : (
        <>
          <PublicRideSelector value={mode} onValueChange={setMode} />
          <CanvasWidget
            icon={UsersThreeIcon}
            title="Nearby riders"
            accent={theme.palette.cyan.color}
            action={
              <View style={styles.mapToggle}>
                <Text style={styles.caption}>On map</Text>
                <Switch
                  value={showRidersOnMap}
                  onValueChange={setShowRidersOnMap}
                  accent={theme.palette.cyan.color}
                  accessibilityLabel="Show nearby riders on map"
                  disabled={!riders.length}
                />
              </View>
            }
            surface="secondary"
          >
            {riders.length ? (
              riders.map((rider, index) => (
                <Pressable
                  key={rider.id}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${rider.name}, ${rider.distance}, ${rider.freshness === 'live' ? 'Live' : `Last seen ${rider.age}`}`}
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
                  <View style={styles.flex}>
                    <Text style={styles.name}>{rider.name}</Text>
                    <View style={styles.telemetry}>
                      {rider.battery !== null ? (
                        <>
                          <BatteryMediumIcon size={20} color={theme.palette.groupRide.color} />
                          <Text style={styles.caption}>{reading(rider.battery, '%')}</Text>
                        </>
                      ) : null}
                      <GaugeIcon size={15} color={theme.neutral.textSecondary} />
                      <Text style={[styles.caption, styles.flex]}>
                        {rider.board ? speed(rider) : 'Board disconnected · —'}
                      </Text>
                    </View>
                    {rider.freshness === 'recent' ? (
                      <Text style={styles.caption}>
                        Last seen {rider.age} · {rider.updatedAt}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.secondary}>{rider.distance}</Text>
                  <CaretRightIcon size={18} color={theme.neutral.textSecondary} />
                </Pressable>
              ))
            ) : (
              <Text style={[styles.secondary, styles.empty]}>
                You’re private. Choose a public ride mode to see simulated nearby riders.
              </Text>
            )}
            {riders.length ? <Legend /> : null}
          </CanvasWidget>
        </>
      )}
      {selected || mapOpen ? (
        <>
          <Legend />
          <Text style={styles.caption}>
            If updates stop, the last known location is shown with its age.
          </Text>
          <View style={[surface, styles.summary]}>
            <BroadcastIcon size={22} color={theme.palette.groupRide.color} />
            <Text style={[styles.name, styles.flex]}>
              {PUBLIC_MODES.find((option) => option.value === mode)?.title}
            </Text>
            <Button
              label="Go private"
              icon={EyeSlashIcon}
              variant="secondary"
              onPress={goPrivate}
            />
          </View>
          {selected ? (
            <Button
              label={`Simulate ${selected.name} going private`}
              variant="secondary"
              onPress={() => {
                setHidden([...hidden, selected.id])
                navigate(null)
              }}
            />
          ) : null}
        </>
      ) : hidden.length ? (
        <Button label="Reset simulated riders" variant="secondary" onPress={() => setHidden([])} />
      ) : null}
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
      <UserCircleIcon size={large ? 64 : 42} color={theme.neutral.textSecondary} weight="thin" />
      <View style={styles.avatarDot}>
        <Dot recent={rider.freshness === 'recent'} />
      </View>
    </View>
  )
}
function Freshness({ rider }: { rider: MockRider }) {
  return (
    <View style={styles.freshness}>
      <Dot recent={rider.freshness === 'recent'} />
      <Text style={styles.caption}>
        {rider.freshness === 'live'
          ? `Live · Updated ${rider.age}`
          : `No recent updates · ${rider.age} · ${rider.updatedAt}`}
      </Text>
    </View>
  )
}
function Legend() {
  return (
    <View style={styles.legend}>
      <Dot />
      <Text style={styles.caption}>Live</Text>
      <Dot recent />
      <Text style={styles.caption}>Last seen recently</Text>
    </View>
  )
}

/** Deliberately schematic, local-only preview: never mounts a location-aware map. */
function MockMap({
  riders,
  onSelect,
  expanded = false,
}: {
  riders: MockRider[]
  onSelect?: (rider: MockRider) => void
  expanded?: boolean
}) {
  const neutral = useResolvedNeutralColors()
  return (
    <View
      style={[
        styles.map,
        {
          height: expanded ? 330 : 155,
          backgroundColor: neutral.surface,
          borderColor: neutral.border,
        },
      ]}
    >
      {[15, 35, 55, 75, 95].map((offset) => (
        <View
          key={`v${offset}`}
          style={[styles.street, { left: `${offset}%`, backgroundColor: neutral.border }]}
        />
      ))}
      {[25, 55, 85].map((offset) => (
        <View
          key={`h${offset}`}
          style={[styles.crossStreet, { top: `${offset}%`, backgroundColor: neutral.border }]}
        />
      ))}
      <Text style={styles.mapCaption}>Simulated map · sample locations</Text>
      <View style={[styles.marker, { left: '12%', top: '42%' }]}>
        <Text style={styles.markerText}>You</Text>
        <View style={[styles.pin, { borderColor: theme.palette.cyan.color }]} />
      </View>
      {riders.map((rider) => (
        <Pressable
          key={rider.id}
          disabled={!onSelect}
          accessibilityRole="button"
          accessibilityLabel={`View ${rider.name}`}
          onPress={() => onSelect?.(rider)}
          style={[styles.marker, { left: `${rider.position.x}%`, top: `${rider.position.y}%` }]}
        >
          <Text style={styles.markerText}>{rider.name}</Text>
          <View
            style={[
              styles.pin,
              {
                borderColor:
                  rider.freshness === 'recent'
                    ? theme.palette.amber.color
                    : theme.palette.groupRide.color,
              },
            ]}
          />
        </Pressable>
      ))}
      {riders.length === 1 ? (
        <Text style={styles.mapFooter}>
          {riders[0].freshness === 'recent' ? 'Last known location · ' : 'Distance from you · '}
          {riders[0].distance}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  panel: { padding: 16, gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mapToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: theme.neutral.textPrimary, fontSize: 15, fontWeight: '700' },
  nameLarge: { color: theme.neutral.textPrimary, fontSize: 24, fontWeight: '700' },
  secondary: { color: theme.neutral.textSecondary, fontSize: 13, lineHeight: 20 },
  caption: { color: theme.neutral.textSecondary, fontSize: 11, lineHeight: 17, flexShrink: 1 },
  rider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    minHeight: 68,
  },
  telemetry: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  avatarDot: { position: 'absolute', bottom: 3, right: 3 },
  freshness: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    flexWrap: 'wrap',
  },
  empty: { paddingVertical: 20 },
  stats: { flexDirection: 'row', gap: 8, paddingVertical: 10 },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { color: theme.neutral.textPrimary, fontSize: 20, fontWeight: '700' },
  reading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  summary: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10, flexWrap: 'wrap' },
  map: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  street: {
    position: 'absolute',
    width: 4,
    height: '150%',
    transform: [{ rotate: '-22deg' }],
    opacity: 0.3,
  },
  crossStreet: {
    position: 'absolute',
    height: 3,
    width: '120%',
    transform: [{ rotate: '-16deg' }],
    opacity: 0.3,
  },
  mapCaption: {
    position: 'absolute',
    top: 8,
    left: 10,
    fontSize: 10,
    color: theme.neutral.textMuted,
  },
  marker: {
    position: 'absolute',
    alignItems: 'center',
    minWidth: 44,
    minHeight: 44,
    marginLeft: -22,
    marginTop: -22,
  },
  markerText: { fontSize: 12, fontWeight: '700', color: theme.neutral.textPrimary },
  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    backgroundColor: theme.control.background,
  },
  mapFooter: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    fontSize: 11,
    color: theme.neutral.textSecondary,
  },
})
