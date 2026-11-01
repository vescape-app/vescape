import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  BroadcastIcon,
  CalendarBlankIcon,
  ClockIcon,
  PowerIcon,
  InfinityIcon,
  NavigationArrowIcon,
  type Icon,
} from 'phosphor-react-native'
import * as Haptics from 'expo-haptics'
import { Canvas, Text as SkiaText } from '@shopify/react-native-skia'
import { useSkiaFont } from '@/hooks/useSkiaFont'
import Svg, { Path } from 'react-native-svg'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useAnimatedProps,
  useDerivedValue,
  type SharedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { createPublicRideInteraction } from '@/modules/group-ride/lib/publicRideInteraction'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { Text } from '@/components/base/Text'
import { blend, theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'
import {
  PUBLIC_RIDE_ARC,
  publicRideStableIndexAt,
  publicRideSector,
} from '@/modules/group-ride/lib/publicRideArc'
import {
  PUBLIC_MODES,
  PUBLIC_RIDE_DURATIONS,
  publicRideDurationLabel,
  type PublicMode,
} from './fixtures'

const BROADCAST_Y = PUBLIC_RIDE_ARC.cy - 22
const RULER_EDGE_INSET =
  (Math.asin(PUBLIC_RIDE_ARC.gap / 2 / PUBLIC_RIDE_ARC.outerRadius) * 180) / Math.PI
const RULER_START = PUBLIC_RIDE_ARC.startAngle + PUBLIC_RIDE_ARC.sectorAngle + RULER_EDGE_INSET
const DURATION_COUNT = PUBLIC_RIDE_DURATIONS.length
const ALWAYS_STOP = DURATION_COUNT + 1
const RULER_STEP = (PUBLIC_RIDE_ARC.sectorAngle * 2 - RULER_EDGE_INSET * 2) / (DURATION_COUNT + 1)
const FIRST_TICK = RULER_START + RULER_STEP

const ICONS = [PowerIcon, NavigationArrowIcon, CalendarBlankIcon, InfinityIcon]
const HOUR_ICONS = [PowerIcon, ClockIcon, InfinityIcon]
const SECTORS = PUBLIC_MODES.map((_, index) => publicRideSector(index))
const HOUR_SECTORS = [SECTORS[0], publicRideSector(1, 2), SECTORS[3]]
const HOUR_TITLES = ['Off', ...PUBLIC_RIDE_DURATIONS.map(publicRideDurationLabel), 'Always']
const HOUR_DESCRIPTIONS = [
  'Your location is hidden',
  ...PUBLIC_RIDE_DURATIONS.map((hours) =>
    hours >= 48
      ? `Visible for ${hours / 24} days`
      : `Visible for ${hours} ${hours === 1 ? 'hour' : 'hours'}`,
  ),
  PUBLIC_MODES[3].subtitle,
]
const TICK_PATH = Array.from({ length: DURATION_COUNT }, (_, index) => {
  const angle = ((FIRST_TICK + index * RULER_STEP) * Math.PI) / 180
  const { cx, cy, outerRadius } = PUBLIC_RIDE_ARC
  return `M ${cx + Math.cos(angle) * outerRadius} ${cy + Math.sin(angle) * outerRadius} L ${cx + Math.cos(angle) * (outerRadius - 11)} ${cy + Math.sin(angle) * (outerRadius - 11)}`
}).join(' ')
const AnimatedPath = Animated.createAnimatedComponent(Path)
const AnimatedText = Animated.createAnimatedComponent(Text)

interface Readout {
  sector: number
  title: string
  description: string
  rotation: number
  timed: boolean
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
}: {
  path: string
  index: number
  readout: SharedValue<Readout>
  surface: string
  border: string
  accent: string
  activeFill: string
  muted: string
}) {
  const props = useAnimatedProps(() => ({
    fill: readout.get().sector === index && index > 0 ? activeFill : surface,
    stroke: readout.get().sector === index ? (index === 0 ? muted : accent) : border,
  }))
  return <AnimatedPath d={path} animatedProps={props} strokeWidth={1} />
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
    opacity: (index < 0 ? readout.get().sector > 0 : index > 0 && readout.get().sector === index)
      ? 1
      : 0,
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

/** Skia paints live text without native text-input commits or React renders. */
function ReadoutText({
  readout,
  description = false,
  accent,
  muted,
}: {
  readout: SharedValue<Readout>
  description?: boolean
  accent: string
  muted: string
}) {
  'use no memo'
  const height = description ? 22 : 16
  const font = useSkiaFont(description ? '600' : '700', description ? 16 : 12)
  const canvasSize = useSharedValue({ width: 0, height })
  const layout = useMemo(() => {
    if (!font) return null
    const strings = description
      ? [...HOUR_DESCRIPTIONS, ...PUBLIC_MODES.map((option) => option.subtitle)]
      : HOUR_TITLES
    const widths = Object.fromEntries(strings.map((text) => [text, font.measureText(text).width]))
    const { ascent, descent } = font.getMetrics()
    return { widths, baseline: height / 2 - (ascent + descent) / 2 }
  }, [font, description, height])
  const text = useDerivedValue(() =>
    description ? readout.get().description : readout.get().title,
  )
  const x = useDerivedValue(() => (canvasSize.get().width - (layout?.widths[text.get()] ?? 0)) / 2)
  const color = useDerivedValue(() => (description ? muted : readout.get().timed ? accent : muted))
  return (
    <View
      accessible
      accessibilityLabel={
        description ? 'Selected visibility duration' : 'Selected sharing duration'
      }
      style={description ? styles.description : styles.liveLabel}
    >
      <Canvas pointerEvents="none" style={{ height }} onSize={canvasSize}>
        {font && layout ? (
          <SkiaText text={text} x={x} y={layout.baseline} font={font} color={color} />
        ) : null}
      </Canvas>
    </View>
  )
}

/** Presentation only: the owner decides what selecting a sharing duration does. */
export function PublicRideSelector({
  value,
  onValueChange,
  profileAction,
  durationControl,
  hours,
}: {
  value: PublicMode
  hours?: number
  durationControl?: ReactNode
  profileAction?: ReactNode
  onValueChange: (mode: PublicMode, hours?: number) => void
}) {
  'use no memo'
  useRenderRateWarning('PublicRideSelector')
  const neutral = useResolvedNeutralColors()
  const accent = useResolvedColor(theme.palette.groupRide.color)
  const activeFill = blend(neutral.surfaceDeep, accent, 0.12)
  const [width, setWidth] = useState<number>(PUBLIC_RIDE_ARC.width)
  const scale = width / PUBLIC_RIDE_ARC.width
  const hourly = hours !== undefined
  const durationStop = Math.max(0, PUBLIC_RIDE_DURATIONS.indexOf(hours ?? 2)) + 1
  const options = hourly
    ? [
        PUBLIC_MODES[0],
        {
          value: 'hours' as const,
          title: publicRideDurationLabel(hours),
          subtitle: HOUR_DESCRIPTIONS[durationStop],
        },
        PUBLIC_MODES[3],
      ]
    : PUBLIC_MODES
  const sectors = hourly ? HOUR_SECTORS : SECTORS
  const icons = hourly ? HOUR_ICONS : ICONS
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const stop = hourly
    ? value === 'off'
      ? 0
      : value === 'automatic'
        ? ALWAYS_STOP
        : durationStop
    : selected
  const initial = useSharedValue(stop)
  const detent = useSharedValue(stop)
  const dragging = useSharedValue(false)
  const touchStartX = useSharedValue(0)
  const touchStartY = useSharedValue(0)
  const readout = useDerivedValue<Readout>(() => {
    const next = detent.get()
    const sector = hourly ? (next === 0 ? 0 : next === ALWAYS_STOP ? 2 : 1) : next
    return {
      sector,
      title: hourly
        ? HOUR_TITLES[Math.max(1, Math.min(DURATION_COUNT, next))]
        : PUBLIC_MODES[next].title,
      description: hourly ? HOUR_DESCRIPTIONS[next] : PUBLIC_MODES[next].subtitle,
      rotation: FIRST_TICK + (next - 1) * RULER_STEP + 90,
      timed: hourly && next > 0 && next < ALWAYS_STOP,
    }
  })
  const wave = useSharedValue(1)
  const previous = useRef(value)
  const live = value !== 'off'

  useEffect(() => {
    initial.set(stop)
    if (!dragging.get()) detent.set(stop)
  }, [initial, detent, dragging, stop])

  useEffect(() => {
    cancelAnimation(wave)
    if (previous.current !== value && value !== 'off') {
      wave.set(0)
      wave.set(withRepeat(withTiming(1, { duration: 700 }), 2, false))
    } else {
      wave.set(1)
    }
    previous.current = value
    return () => cancelAnimation(wave)
  }, [value, wave])

  const waveStyle = useAnimatedStyle(() => ({
    opacity: (1 - wave.get()) * 0.65,
    transform: [{ scale: 0.7 + wave.get() * 1.3 }],
  }))

  const select = useCallback(
    (index: number) => {
      if (index < 0) return
      void Haptics.impactAsync(
        index === 0 ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Soft,
      )
      if (hourly) {
        onValueChange(
          index === 0 ? 'off' : index === ALWAYS_STOP ? 'automatic' : 'hours',
          index > 0 && index < ALWAYS_STOP ? PUBLIC_RIDE_DURATIONS[index - 1] : undefined,
        )
      } else onValueChange(PUBLIC_MODES[index].value)
    },
    [onValueChange, hourly],
  )

  const gesture = useMemo(() => {
    const interaction = createPublicRideInteraction({
      preview: detent,
      initial,
      active: dragging,
      indexAt: (x, y, continuing) => {
        'worklet'
        const previewStop = detent.get()
        const previewStopSector = hourly
          ? previewStop === 0
            ? 0
            : previewStop === ALWAYS_STOP
              ? 3
              : previewStop <= DURATION_COUNT / 2
                ? 1
                : 2
          : previewStop
        let next = publicRideStableIndexAt(x / scale, y / scale, previewStopSector, continuing)
        if (hourly && next >= 0) {
          const angle =
            (Math.atan2(y / scale - PUBLIC_RIDE_ARC.cy, x / scale - PUBLIC_RIDE_ARC.cx) * 180) /
            Math.PI
          next =
            next === 0
              ? 0
              : next === 3
                ? ALWAYS_STOP
                : Math.max(
                    1,
                    Math.min(DURATION_COUNT, 1 + Math.round((angle - FIRST_TICK) / RULER_STEP)),
                  )
        }
        return next
      },
      onCommit: (next) => {
        'worklet'
        scheduleOnRN(select, next)
      },
    })
    const pan = Gesture.Pan()
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
    const tap = Gesture.Tap().onEnd((event, success) => {
      if (!success) return
      interaction.begin(event.x, event.y)
      interaction.finish(true)
    })
    return Gesture.Race(pan, tap)
  }, [detent, initial, dragging, touchStartX, touchStartY, scale, select, hourly])

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: readout.get().timed ? 1 : 0,
    transform: [{ rotate: `${readout.get().rotation}deg` }],
  }))

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <BroadcastIcon size={22} color={accent} style={styles.headerIcon} />
        <View style={styles.heading}>
          <Text style={[styles.title, { color: neutral.textPrimary }]}>Public ride</Text>
          <Text style={[styles.intro, { color: neutral.textSecondary }]}>Share your location</Text>
        </View>
        <View style={styles.profileControls}>
          {profileAction ?? (
            <Text style={[styles.status, { color: live ? accent : neutral.textSecondary }]}>
              {live ? 'LIVE' : 'PRIVATE'}
            </Text>
          )}
          {durationControl ? <View style={styles.floatingDuration}>{durationControl}</View> : null}
        </View>
      </View>
      <View style={styles.content}>
        <GestureDetector gesture={gesture}>
          <View
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            style={[styles.arc, { height: PUBLIC_RIDE_ARC.height * scale }]}
            testID="public-ride-selector"
            accessibilityRole="radiogroup"
            accessibilityLabel="Public ride duration"
          >
            <Svg
              width={width}
              height={PUBLIC_RIDE_ARC.height * scale}
              viewBox={`0 0 ${PUBLIC_RIDE_ARC.width} ${PUBLIC_RIDE_ARC.height}`}
              style={StyleSheet.absoluteFill}
            >
              {sectors.map((sector, index) => (
                <Sector
                  key={index}
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
              {hourly ? (
                <Path
                  d={TICK_PATH}
                  stroke={neutral.textSecondary}
                  strokeWidth={1}
                  strokeLinecap="round"
                />
              ) : null}
            </Svg>
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: (PUBLIC_RIDE_ARC.cx - 9) * scale,
                top: (BROADCAST_Y - 9) * scale,
              }}
            >
              <PreviewGlyph
                icon={BroadcastIcon}
                index={-1}
                readout={readout}
                accent={accent}
                muted={neutral.textSecondary}
                size={18 * scale}
              />
            </View>
            {hourly ? (
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
                      height: 17 * scale,
                    },
                  ]}
                />
              </Animated.View>
            ) : null}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.wave,
                {
                  left: PUBLIC_RIDE_ARC.cx * scale - 15,
                  top: BROADCAST_Y * scale - 15,
                  borderColor: accent,
                },
                waveStyle,
              ]}
            />
            {options.map((option, index) => {
              const Icon = icons[index]
              const active = selected === index
              return (
                <View
                  accessible
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${option.title}. ${option.subtitle}`}
                  accessibilityActions={[{ name: 'activate' }]}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName !== 'activate') return
                    select(
                      hourly ? (index === 0 ? 0 : index === 2 ? ALWAYS_STOP : durationStop) : index,
                    )
                  }}
                  onAccessibilityTap={() =>
                    select(
                      hourly ? (index === 0 ? 0 : index === 2 ? ALWAYS_STOP : durationStop) : index,
                    )
                  }
                  style={[
                    styles.choice,
                    {
                      left: sectors[index].label.x * scale - 35,
                      top: (sectors[index].label.y + (hourly && index === 1 ? 12 : 0)) * scale - 24,
                    },
                  ]}
                >
                  <PreviewGlyph
                    icon={Icon}
                    index={index}
                    readout={readout}
                    accent={accent}
                    muted={neutral.textSecondary}
                  />
                  {hourly && index === 1 ? (
                    <ReadoutText readout={readout} accent={accent} muted={neutral.textSecondary} />
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
        <ReadoutText readout={readout} description accent={accent} muted={neutral.textPrimary} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  indicatorPivot: { position: 'absolute', width: 0, height: 0 },
  indicator: { position: 'absolute', width: 4, left: -2, borderRadius: 2 },
  liveLabel: {
    width: 70,
  },
  root: { gap: 0 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6, zIndex: 1 },
  headerIcon: { marginTop: 3 },
  heading: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 17, fontWeight: '700' },
  content: { gap: 0 },
  profileControls: { alignItems: 'flex-end' },
  floatingDuration: { position: 'absolute', top: '100%', right: 0, marginTop: 4 },
  intro: { fontSize: 11, lineHeight: 16, maxWidth: 210 },
  arc: {
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
  },
  wave: { position: 'absolute', width: 30, height: 30, borderRadius: 15, borderWidth: 1 },
  choice: {
    position: 'absolute',
    width: 70,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  status: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  description: {
    marginTop: -22,
    marginBottom: 10,
  },
})
