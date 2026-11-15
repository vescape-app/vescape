import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { BroadcastIcon, ClockIcon, PowerIcon, InfinityIcon, type Icon } from 'phosphor-react-native'
import * as Haptics from 'expo-haptics'
import Svg, { Path } from 'react-native-svg'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useAnimatedReaction,
  useAnimatedProps,
  useDerivedValue,
  type SharedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { Text } from '@/components/base/Text'
import { blend, theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'
import { PUBLIC_RIDE_DURATIONS, type PublicRideChoice } from '@/modules/group-ride/lib/publicRide'
import {
  PUBLIC_RIDE_ARC,
  publicRideStableIndexAt,
  publicRideSector,
} from '@/modules/group-ride/lib/publicRideArc'
import {
  BROADCAST_WAVE_MS,
  BroadcastGlyph,
  RING_START,
} from '@/modules/group-ride/components/BroadcastGlyph'
import { createPublicRideInteraction } from '@/modules/group-ride/lib/publicRideInteraction'
import {
  PublicRideReadout,
  HOUR_TITLES,
  HOUR_DESCRIPTIONS,
  type PublicRideReadoutState as Readout,
} from '@/modules/group-ride/components/PublicRideReadout'

const BROADCAST_Y = PUBLIC_RIDE_ARC.cy - 22
const BROADCAST_SIZE = 24
const WAVE_RADIUS = PUBLIC_RIDE_ARC.innerRadius - (PUBLIC_RIDE_ARC.cy - BROADCAST_Y)
const RULER_EDGE_INSET =
  (Math.asin(PUBLIC_RIDE_ARC.gap / 2 / PUBLIC_RIDE_ARC.outerRadius) * 180) / Math.PI
const RULER_START = PUBLIC_RIDE_ARC.startAngle + PUBLIC_RIDE_ARC.sectorAngle + RULER_EDGE_INSET
const DURATION_COUNT = PUBLIC_RIDE_DURATIONS.length
const ALWAYS_STOP = DURATION_COUNT + 1
const RULER_STEP = (PUBLIC_RIDE_ARC.sectorAngle * 2 - RULER_EDGE_INSET * 2) / (DURATION_COUNT + 1)
const FIRST_TICK = RULER_START + RULER_STEP

const ICONS = [PowerIcon, ClockIcon, InfinityIcon]
const SECTORS = [publicRideSector(0), publicRideSector(1, 2), publicRideSector(3)]
const TICK_PATH = Array.from({ length: DURATION_COUNT }, (_, index) => {
  const angle = ((FIRST_TICK + index * RULER_STEP) * Math.PI) / 180
  const { cx, cy, outerRadius } = PUBLIC_RIDE_ARC
  const innerRadius = outerRadius - (PUBLIC_RIDE_DURATIONS[index] === 12 ? 12 : 7)
  return `M ${cx + Math.cos(angle) * outerRadius} ${cy + Math.sin(angle) * outerRadius} L ${cx + Math.cos(angle) * innerRadius} ${cy + Math.sin(angle) * innerRadius}`
}).join(' ')
const AnimatedPath = Animated.createAnimatedComponent(Path)
const AnimatedText = Animated.createAnimatedComponent(Text)

/** Detent of a choice: 0 off, 1…DURATION_COUNT a duration, ALWAYS_STOP always. */
function stopOf(choice: PublicRideChoice) {
  if (choice.mode === 'off') return 0
  if (choice.mode === 'always') return ALWAYS_STOP
  return Math.max(0, PUBLIC_RIDE_DURATIONS.indexOf(choice.hours)) + 1
}

function choiceAt(stop: number): PublicRideChoice {
  if (stop === 0) return { mode: 'off' }
  if (stop === ALWAYS_STOP) return { mode: 'always' }
  return { mode: 'hours', hours: PUBLIC_RIDE_DURATIONS[stop - 1] }
}

function sectorOf(stop: number) {
  'worklet'
  return stop === 0 ? 0 : stop === ALWAYS_STOP ? 2 : 1
}

function Sector({
  path,
  index,
  readout,
  surface,
  border,
  accent,
  activeFill,
  muted,
  initialActive,
}: {
  initialActive: boolean
  path: string
  index: number
  readout: SharedValue<Readout>
  surface: string
  border: string
  accent: string
  activeFill: string
  muted: string
}) {
  const opacity = useSharedValue(initialActive ? 1 : 0)
  useAnimatedReaction(
    () => readout.get().sector === index,
    (active, previous) => {
      if (active !== previous) opacity.set(withTiming(active ? 1 : 0, { duration: 80 }))
    },
  )
  const props = useAnimatedProps(() => ({ opacity: opacity.get() }))
  return (
    <>
      <Path d={path} fill={surface} stroke={border} strokeWidth={1} />
      <AnimatedPath
        d={path}
        fill={index > 0 ? activeFill : surface}
        stroke={index === 0 ? muted : accent}
        animatedProps={props}
        strokeWidth={1}
      />
    </>
  )
}

/** Icons and labels share the same preview as the sector, including before release. */
function PreviewGlyph({
  icon: IconComponent,
  index,
  readout,
  accent,
  muted,
  size = 20,
}: {
  icon: Icon
  index: number
  readout: SharedValue<Readout>
  accent: string
  muted: string
  size?: number
}) {
  const style = useAnimatedStyle(() => ({
    opacity: index > 0 && readout.get().sector === index ? 1 : 0,
  }))
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <IconComponent size={size} color={muted} />
      <Animated.View style={[StyleSheet.absoluteFill, style]}>
        <IconComponent size={size} color={accent} />
      </Animated.View>
    </View>
  )
}

function PreviewLabel({
  title,
  index,
  readout,
  accent,
  muted,
}: {
  title: string
  index: number
  readout: SharedValue<Readout>
  accent: string
  muted: string
}) {
  const style = useAnimatedStyle(() => ({
    color: index > 0 && readout.get().sector === index ? accent : muted,
  }))
  return <AnimatedText style={[styles.label, style]}>{title}</AnimatedText>
}

/**
 * The public ride switch: off, a number of hours, or always. Presentation only: the owner decides
 * what a choice does. `live` lights the header while the rider is public.
 */
export function PublicRideSelector({
  value,
  live,
  headerAction,
  overlayAction,
  disabled: controlDisabled = false,
  onValueChange,
}: {
  value: PublicRideChoice
  live: boolean
  headerAction?: ReactNode
  overlayAction?: ReactNode
  disabled?: boolean
  onValueChange: (choice: PublicRideChoice) => void
}) {
  'use no memo'
  const disabled = controlDisabled || !!overlayAction
  const neutral = useResolvedNeutralColors()
  const accent = useResolvedColor(theme.palette.groupRide.color)
  const activeFill = blend(neutral.surfaceDeep, accent, 0.12)
  const [width, setWidth] = useState<number>(PUBLIC_RIDE_ARC.width)
  const scale = width / PUBLIC_RIDE_ARC.width
  const stop = stopOf(value)
  const selected = sectorOf(stop)
  const options = [
    { title: 'Off', subtitle: HOUR_DESCRIPTIONS[0] },
    {
      title: value.mode === 'hours' ? HOUR_TITLES[stop] : 'Timer',
      subtitle: HOUR_DESCRIPTIONS[value.mode === 'hours' ? stop : 2],
    },
    { title: 'Always', subtitle: HOUR_DESCRIPTIONS[ALWAYS_STOP] },
  ]
  const durationStop = value.mode === 'hours' ? stop : 2
  const initial = useSharedValue(stop)
  const detent = useSharedValue(stop)
  const dragging = useSharedValue(false)
  const touchStartX = useSharedValue(0)
  const touchStartY = useSharedValue(0)
  const readout = useDerivedValue<Readout>(() => {
    const next = detent.get()
    const timed = next > 0 && next < ALWAYS_STOP
    return {
      sector: sectorOf(next),
      title: timed ? HOUR_TITLES[next] : 'Timer',
      description: HOUR_DESCRIPTIONS[next],
      rotation: FIRST_TICK + (next - 1) * RULER_STEP + 90,
      timed,
    }
  })
  const wave = useSharedValue(1)
  const previous = useRef(value.mode)

  useEffect(() => {
    initial.set(stop)
    if (!dragging.get()) detent.set(stop)
  }, [initial, detent, dragging, stop])

  useEffect(() => {
    cancelAnimation(wave)
    if (live) {
      // Sharing: the radar keeps pinging for as long as the rider is public.
      wave.set(0)
      wave.set(withRepeat(withTiming(1, { duration: BROADCAST_WAVE_MS }), -1, false))
    } else if (previous.current === 'off' && value.mode !== 'off') {
      wave.set(0)
      wave.set(withRepeat(withTiming(1, { duration: 700 }), 2, false))
    } else {
      wave.set(1)
    }
    previous.current = value.mode
    return () => cancelAnimation(wave)
  }, [live, value.mode, wave])

  const rulerProps = useAnimatedProps(() => ({
    stroke: readout.get().timed ? neutral.textSecondary : neutral.border,
  }))

  // One wave: the icon lights from the centre out (dot, inner arcs, outer arcs), then the ring
  // carries the same motion on to the inner arc.
  const waveStyle = useAnimatedStyle(() => {
    const ring = Math.min(1, Math.max(0, (wave.get() - RING_START) / (1 - RING_START)))
    return {
      opacity: ring > 0 ? (1 - ring) * 0.65 : 0,
      transform: [{ scale: 0.2 + ring * 0.8 }],
    }
  })

  const select = useCallback(
    (index: number) => {
      if (index < 0) return
      void Haptics.impactAsync(
        index === 0 ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Soft,
      )
      onValueChange(choiceAt(index))
    },
    [onValueChange],
  )

  const gesture = useMemo(() => {
    const interaction = createPublicRideInteraction({
      preview: detent,
      initial,
      active: dragging,
      indexAt: (x, y, continuing) => {
        'worklet'
        const previewStop = detent.get()
        const previewSector =
          previewStop === 0
            ? 0
            : previewStop === ALWAYS_STOP
              ? 3
              : previewStop <= DURATION_COUNT / 2
                ? 1
                : 2
        const next = publicRideStableIndexAt(x / scale, y / scale, previewSector, continuing)
        if (next <= 0) return next
        if (next === 3) return ALWAYS_STOP
        const angle =
          (Math.atan2(y / scale - PUBLIC_RIDE_ARC.cy, x / scale - PUBLIC_RIDE_ARC.cx) * 180) /
          Math.PI
        return Math.max(
          1,
          Math.min(DURATION_COUNT, 1 + Math.round((angle - FIRST_TICK) / RULER_STEP)),
        )
      },
      onCommit: (next) => {
        'worklet'
        scheduleOnRN(select, next)
      },
    })
    const pan = Gesture.Pan()
      .enabled(!disabled)
      .minDistance(6)
      .shouldCancelWhenOutside(false)
      .onBegin((event) => {
        touchStartX.set(event.x)
        touchStartY.set(event.y)
      })
      .onStart((event) => {
        interaction.begin(touchStartX.get(), touchStartY.get())
        interaction.move(event.x, event.y)
      })
      .onUpdate((event) => interaction.move(event.x, event.y))
      .onFinalize((_event, success) => interaction.finish(success))
    const tap = Gesture.Tap()
      .enabled(!disabled)
      .onEnd((event, success) => {
        if (!success) return
        interaction.begin(event.x, event.y)
        interaction.finish(true)
      })
    return Gesture.Race(pan, tap)
  }, [detent, initial, dragging, touchStartX, touchStartY, scale, select, disabled])
  const indicatorRotation = useDerivedValue(() => {
    const target = readout.get().rotation
    if (!readout.get().timed || dragging.get()) return target
    return withTiming(target, { duration: 380 })
  })
  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: readout.get().timed ? 1 : 0,
    transform: [{ rotate: `${indicatorRotation.get()}deg` }],
  }))

  return (
    <View>
      <View style={styles.header}>
        <BroadcastIcon size={22} color={accent} style={styles.headerIcon} />
        <View style={styles.heading}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: neutral.textPrimary }]}>Public ride</Text>
            {live ? (
              <View style={styles.live}>
                <View style={[styles.liveDot, { backgroundColor: accent }]} />
                <Text style={[styles.status, { color: accent }]}>LIVE</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.intro, { color: neutral.textSecondary }]}>Share your location</Text>
        </View>
        {headerAction}
      </View>
      <View
        pointerEvents={overlayAction ? 'none' : 'auto'}
        accessibilityElementsHidden={!!overlayAction}
        importantForAccessibility={overlayAction ? 'no-hide-descendants' : 'auto'}
      >
        <GestureDetector gesture={gesture}>
          <View
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            style={[
              styles.arc,
              { height: PUBLIC_RIDE_ARC.height * scale },
              disabled && !overlayAction && styles.disabled,
            ]}
            testID="public-ride-selector"
            accessibilityRole="radiogroup"
            accessibilityLabel="Public ride duration"
            accessibilityState={{ disabled }}
          >
            <Svg
              width={width}
              height={PUBLIC_RIDE_ARC.height * scale}
              viewBox={`0 0 ${PUBLIC_RIDE_ARC.width} ${PUBLIC_RIDE_ARC.height}`}
              style={StyleSheet.absoluteFill}
            >
              {SECTORS.map((sector, index) => (
                <Sector
                  key={index}
                  initialActive={selected === index}
                  path={sector.path}
                  index={index}
                  readout={readout}
                  surface={neutral.surfaceDeep}
                  border={neutral.border}
                  accent={accent}
                  activeFill={activeFill}
                  muted={neutral.textSecondary}
                />
              ))}
              <AnimatedPath
                d={TICK_PATH}
                animatedProps={rulerProps}
                strokeWidth={1}
                strokeLinecap="round"
              />
            </Svg>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.wave,
                {
                  // Rings out from the icon and fades where it meets the inner arc.
                  left: (PUBLIC_RIDE_ARC.cx - WAVE_RADIUS) * scale,
                  top: (BROADCAST_Y - WAVE_RADIUS) * scale,
                  width: WAVE_RADIUS * 2 * scale,
                  height: WAVE_RADIUS * 2 * scale,
                  borderColor: accent,
                },
                waveStyle,
              ]}
            />
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: (PUBLIC_RIDE_ARC.cx - BROADCAST_SIZE / 2) * scale,
                top: (BROADCAST_Y - BROADCAST_SIZE / 2) * scale,
              }}
            >
              <BroadcastGlyph
                size={BROADCAST_SIZE * scale}
                color={live ? accent : neutral.textSecondary}
                wave={wave}
                pulsing={live}
              />
            </View>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.indicatorPivot,
                { left: PUBLIC_RIDE_ARC.cx * scale, top: PUBLIC_RIDE_ARC.cy * scale },
                indicatorStyle,
              ]}
            >
              <View
                style={[
                  styles.indicator,
                  {
                    backgroundColor: accent,
                    top: -PUBLIC_RIDE_ARC.outerRadius * scale,
                    height: 20 * scale,
                  },
                ]}
              />
            </Animated.View>
            {options.map((option, index) => {
              const target = index === 0 ? 0 : index === 2 ? ALWAYS_STOP : durationStop
              return (
                <View
                  accessible
                  key={index}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected === index, disabled }}
                  accessibilityLabel={`${option.title}. ${option.subtitle}`}
                  accessibilityActions={[{ name: 'activate' }]}
                  onAccessibilityAction={(event) => {
                    if (!disabled && event.nativeEvent.actionName === 'activate') select(target)
                  }}
                  onAccessibilityTap={() => {
                    if (!disabled) select(target)
                  }}
                  style={[
                    styles.choice,
                    {
                      left: SECTORS[index].label.x * scale - 35,
                      top: (SECTORS[index].label.y + (index === 1 ? 7 : 0)) * scale - 24,
                    },
                  ]}
                >
                  <PreviewGlyph
                    icon={ICONS[index]}
                    index={index}
                    readout={readout}
                    accent={accent}
                    muted={neutral.textSecondary}
                  />
                  {index === 1 ? (
                    <PublicRideReadout
                      readout={readout}
                      accent={accent}
                      muted={neutral.textSecondary}
                    />
                  ) : (
                    <PreviewLabel
                      title={option.title}
                      index={index}
                      readout={readout}
                      accent={accent}
                      muted={neutral.textSecondary}
                    />
                  )}
                </View>
              )
            })}
          </View>
        </GestureDetector>
        <View style={disabled && styles.disabled}>
          <PublicRideReadout
            readout={readout}
            description
            accent={accent}
            muted={neutral.textPrimary}
          />
        </View>
      </View>
      {overlayAction ? (
        <View style={[styles.overlay, { backgroundColor: theme.alpha(neutral.surfaceDeep, 0.75) }]}>
          <View style={{ transform: [{ translateY: 35 * scale }] }}>{overlayAction}</View>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  indicatorPivot: { position: 'absolute', width: 0, height: 0 },
  indicator: { position: 'absolute', width: 4, left: -2, borderRadius: 2 },
  disabled: { opacity: 0.5 },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6, zIndex: 1 },
  headerIcon: { marginTop: 3 },
  heading: { flex: 1, minWidth: 0, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '700' },
  intro: { fontSize: 11, lineHeight: 16, maxWidth: 210 },
  arc: {
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
  },
  wave: { position: 'absolute', borderRadius: 999, borderWidth: 1.5 },
  choice: {
    position: 'absolute',
    width: 70,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  status: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
})
