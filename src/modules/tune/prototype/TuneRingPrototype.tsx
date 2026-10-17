// THROWAWAY: six deliberately close ring interactions, three pages, local values only.
// Compare radial handles, orbit handles, detents, a fourth axis, a contour and a focus ring.
import { useEffect, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Line, Polygon } from 'react-native-svg'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'
import { ArrowLeftIcon, ArrowRightIcon, MinusIcon, PlusIcon } from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'

const VARIANTS = [
  ['Radial', 'Slide each handle toward or away from your Board.'],
  ['Orbit', 'Sweep each handle around its short arc.'],
  ['Detents', 'Radial travel snaps to ten deliberate steps.'],
  ['Four axes', 'A bottom handle adds a fourth parameter.'],
  ['Contour', 'The outline shows the balance between all three values.'],
  ['Focus', 'Select an axis, then swipe left or right across the disc.'],
] as const
const GROUPS = [
  {
    name: 'Feel',
    labels: ['Aggressiveness', 'Tail stiffness', 'Nose stiffness', 'Braking'],
    defaults: [55, 45, 60, 50],
  },
  {
    name: 'Brake / Turn',
    labels: ['Brake strength', 'Turn response', 'Turn tilt', 'Brake tilt'],
    defaults: [60, 45, 35, 40],
  },
  {
    name: 'ATR',
    labels: ['ATR strength', 'Uphill response', 'Downhill response', 'Recovery'],
    defaults: [50, 65, 40, 55],
  },
] as const
const ANGLES = [-Math.PI / 2, (Math.PI * 5) / 6, Math.PI / 6, Math.PI / 2]
const bound = (n: number) => Math.max(0, Math.min(100, n))

function RingHandle({
  value,
  angle,
  radius,
  center,
  orbit,
  snap,
  selected,
  color,
  label,
  onChange,
  onSelect,
}: {
  value: number
  angle: number
  radius: number
  center: number
  orbit: boolean
  snap: boolean
  selected: boolean
  color: string
  label: string
  onChange: (value: number) => void
  onSelect: () => void
}) {
  'use no memo'
  const live = useSharedValue(value)
  const start = useSharedValue(value)
  useEffect(() => {
    live.set(value)
  }, [live, value])
  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      start.set(live.value)
      scheduleOnRN(onSelect)
    })
    .onUpdate((event) => {
      const movement = orbit
        ? ((-Math.sin(angle) * event.translationX + Math.cos(angle) * event.translationY) /
            radius) *
          100
        : ((Math.cos(angle) * event.translationX + Math.sin(angle) * event.translationY) /
            (radius * 0.42)) *
          100
      const raw = Math.max(0, Math.min(100, start.value + movement))
      live.set(snap ? Math.round(raw / 10) * 10 : Math.round(raw))
    })
    .onEnd(() => {
      scheduleOnRN(onChange, live.value)
    })
  const animated = useAnimatedStyle(() => {
    const a = orbit ? angle + (live.value / 100 - 0.5) * 0.9 : angle
    const r = orbit ? radius * 0.85 : radius * (0.58 + live.value * 0.0042)
    return {
      transform: [
        { translateX: center + Math.cos(a) * r - 22 },
        { translateY: center + Math.sin(a) * r - 22 },
      ],
    }
  })
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          onChange(bound(value + (event.nativeEvent.actionName === 'increment' ? 5 : -5)))
        }
        style={[styles.handleTarget, animated]}
      >
        <View
          style={[
            styles.handle,
            {
              borderColor: color,
              backgroundColor: theme.neutral.surface,
              borderWidth: selected ? 3 : 1.5,
            },
          ]}
        />
      </Animated.View>
    </GestureDetector>
  )
}

export function TuneRingPrototype({
  variant,
  onVariant,
  board,
  boardName,
  onPose,
}: {
  variant: number
  onVariant: (variant: number) => void
  board: ReactNode
  boardName: string
  onPose: (values: readonly number[]) => void
}) {
  const insets = useSafeAreaInsets()
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const colors = [
    accents.purple.color,
    accents.cyan.color,
    accents.orange.color,
    accents.green.color,
  ]
  const [page, setPage] = useState(0)
  const [selection, setSelected] = useState(0)
  const selected = variant !== 4 && selection === 3 ? 0 : selection
  const [values, setValues] = useState<number[][]>(() => GROUPS.map((group) => [...group.defaults]))
  const width = Math.min(useWindowDimensions().width - 24, 420)
  const center = width / 2
  const radius = width * 0.36
  const current = GROUPS[page]
  const count = variant === 4 ? 4 : 3
  const change = (index: number, value: number) => {
    const next = values.map((group, i) =>
      i === page ? group.map((v, j) => (j === index ? bound(value) : v)) : group,
    )
    setValues(next)
    onPose(next[page])
  }
  const points = values[page]
    .slice(0, count)
    .map((value, index) => {
      const r = radius * (0.58 + value * 0.0042)
      return `${center + Math.cos(ANGLES[index]) * r},${center + Math.sin(ANGLES[index]) * r}`
    })
    .join(' ')
  const focusGesture = Gesture.Pan()
    .minDistance(5)
    .onEnd((event) => {
      // Full ring is a horizontal sweep; handle modes retain direct radial gestures.
      scheduleOnRN(
        change,
        selected,
        bound(values[page][selected] + Math.round(event.translationX / 2)),
      )
    })
  return (
    <View style={[styles.root, { backgroundColor: neutral.bg }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 + insets.bottom }]}>
        <View style={styles.heading}>
          <Text style={[styles.eyebrow, { color: accents.purple.text }]}>TUNE LAB · IN MEMORY</Text>
          <Text style={[styles.title, { color: neutral.textPrimary }]}>Find your feel</Text>
          <Text style={[styles.caption, { color: neutral.textMuted }]}>
            Same Board. Six ways to shape the ride.
          </Text>
        </View>
        <View style={styles.tabs}>
          {GROUPS.map((group, index) => (
            <Button
              key={group.name}
              label={group.name}
              size="sm"
              variant={page === index ? 'tune' : 'secondary'}
              style={styles.flex}
              onPress={() => {
                setPage(index)
                setSelected(0)
                onPose(values[index])
              }}
            />
          ))}
        </View>
        <View style={{ width, height: width + 10, alignSelf: 'center' }}>
          <Svg width={width} height={width} pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Circle
              cx={center}
              cy={center}
              r={radius}
              fill={neutral.surfaceDeep}
              stroke={neutral.border}
              strokeWidth={1}
            />
            {[0.58, 0.79].map((ratio) => (
              <Circle
                key={ratio}
                cx={center}
                cy={center}
                r={radius * ratio}
                fill="none"
                stroke={neutral.border}
                strokeWidth={1}
                strokeDasharray={variant === 3 ? '2 7' : undefined}
              />
            ))}
            {Array.from({ length: variant === 3 ? 60 : 36 }, (_, i) => {
              const a = (i * Math.PI * 2) / (variant === 3 ? 60 : 36)
              return (
                <Line
                  key={i}
                  x1={center + Math.cos(a) * (radius + 5)}
                  y1={center + Math.sin(a) * (radius + 5)}
                  x2={center + Math.cos(a) * (radius + (i % 3 === 0 ? 11 : 8))}
                  y2={center + Math.sin(a) * (radius + (i % 3 === 0 ? 11 : 8))}
                  stroke={neutral.textDim}
                  strokeWidth={1}
                />
              )
            })}
            {variant === 5 && (
              <Polygon
                points={points}
                fill={theme.alpha(accents.purple.color, 0.12)}
                stroke={accents.purple.color}
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            )}
            {ANGLES.slice(0, count).map((angle, index) => (
              <Line
                key={angle}
                x1={center + Math.cos(angle) * radius * 0.52}
                y1={center + Math.sin(angle) * radius * 0.52}
                x2={center + Math.cos(angle) * radius}
                y2={center + Math.sin(angle) * radius}
                stroke={index === selected ? colors[index] : neutral.border}
                strokeWidth={1}
                strokeDasharray="2 5"
              />
            ))}
            {variant === 6 && (
              <Circle
                cx={center}
                cy={center}
                r={radius + 4}
                fill="none"
                stroke={colors[selected]}
                strokeWidth={2}
                strokeDasharray={`${(values[page][selected] / 100) * 2 * Math.PI * (radius + 4)} ${2 * Math.PI * (radius + 4)}`}
                transform={`rotate(-90 ${center} ${center})`}
              />
            )}
          </Svg>
          <View
            pointerEvents="none"
            style={[styles.board, { left: center - 90, top: center - 82 }]}
          >
            {board}
            <Text numberOfLines={1} style={[styles.boardName, { color: neutral.textSecondary }]}>
              {boardName}
            </Text>
          </View>
          <Text
            pointerEvents="none"
            style={[styles.axisLabel, { top: 0, left: center - 85, width: 170, color: colors[0] }]}
          >
            {current.labels[0]} · {values[page][0]}
          </Text>
          {[1, 2].map((index) => (
            <Text
              key={index}
              pointerEvents="none"
              style={[
                styles.axisLabel,
                {
                  top: center + radius * 0.62 + 17,
                  left: index === 1 ? 0 : width - 130,
                  width: 130,
                  color: colors[index],
                },
              ]}
            >
              {current.labels[index]}
              {'\n'}
              {values[page][index]}
            </Text>
          ))}
          {count === 4 && (
            <Text
              pointerEvents="none"
              style={[
                styles.axisLabel,
                { top: width - 16, left: center - 70, width: 140, color: colors[3] },
              ]}
            >
              {current.labels[3]} · {values[page][3]}
            </Text>
          )}
          {variant === 6 ? (
            <GestureDetector gesture={focusGesture}>
              <View style={StyleSheet.absoluteFill} />
            </GestureDetector>
          ) : (
            ANGLES.slice(0, count).map((angle, index) => (
              <RingHandle
                key={`${page}-${variant}-${index}`}
                value={values[page][index]}
                angle={angle}
                radius={radius}
                center={center}
                orbit={variant === 2}
                snap={variant === 3}
                selected={selected === index}
                color={colors[index]}
                label={current.labels[index]}
                onSelect={() => setSelected(index)}
                onChange={(value) => change(index, value)}
              />
            ))
          )}
        </View>
        <Text style={[styles.hint, { color: neutral.textMuted }]}>{VARIANTS[variant - 1][1]}</Text>
        <View style={styles.values}>
          {current.labels.slice(0, count).map((label, index) => (
            <Button
              key={label}
              label={`${label}  ${values[page][index]}`}
              size="sm"
              accent={selected === index ? colors[index] : undefined}
              variant="secondary"
              onPress={() => setSelected(index)}
            />
          ))}
        </View>
        <View style={styles.adjust}>
          <IconButton
            icon={MinusIcon}
            accessibilityLabel={`Decrease ${current.labels[selected]}`}
            onPress={() => change(selected, values[page][selected] - (variant === 3 ? 10 : 5))}
          />
          <View style={styles.readout}>
            <Text style={[styles.number, { color: colors[selected] }]}>
              {values[page][selected]}
              <Text style={[styles.unit, { color: neutral.textMuted }]}> / 100</Text>
            </Text>
            <Text style={[styles.caption, { color: neutral.textSecondary }]}>
              {current.labels[selected]}
            </Text>
          </View>
          <IconButton
            icon={PlusIcon}
            accessibilityLabel={`Increase ${current.labels[selected]}`}
            onPress={() => change(selected, values[page][selected] + (variant === 3 ? 10 : 5))}
          />
        </View>
        <View style={styles.reset}>
          <Button
            label="Reset page"
            size="sm"
            variant="secondary"
            onPress={() => {
              setValues(values.map((v, i) => (i === page ? [...current.defaults] : v)))
              onPose(current.defaults)
            }}
          />
          <Button
            label="Reset all"
            size="sm"
            variant="secondary"
            onPress={() => {
              setValues(GROUPS.map((g) => [...g.defaults]))
              onPose(current.defaults)
            }}
          />
        </View>
        <Text style={[styles.disclaimer, { color: neutral.textDim }]}>
          Concept values, 0–100. No firmware mapping. Nothing is saved or sent to your Board.
        </Text>
      </ScrollView>
      <View
        style={[
          styles.switcher,
          {
            bottom: 12 + insets.bottom,
            backgroundColor: neutral.surface,
            borderColor: neutral.border,
          },
        ]}
      >
        <IconButton
          icon={ArrowLeftIcon}
          accessibilityLabel="Previous variant"
          onPress={() => onVariant(variant === 1 ? 6 : variant - 1)}
        />
        <View style={styles.flex}>
          <Text style={[styles.switchTitle, { color: neutral.textPrimary }]}>
            {variant} / 6 · {VARIANTS[variant - 1][0]}
          </Text>
          <Text style={[styles.switchCaption, { color: neutral.textMuted }]}>
            THROWAWAY PROTOTYPE
          </Text>
        </View>
        <IconButton
          icon={ArrowRightIcon}
          accessibilityLabel="Next variant"
          onPress={() => onVariant(variant === 6 ? 1 : variant + 1)}
        />
      </View>
    </View>
  )
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 120, gap: 14 },
  heading: { gap: 5 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  title: { fontSize: 29, fontWeight: '700' },
  caption: { fontSize: 12 },
  tabs: { flexDirection: 'row', gap: 6 },
  flex: { flex: 1 },
  board: { position: 'absolute', alignItems: 'center', width: 180 },
  boardName: { fontSize: 10, marginTop: -25, maxWidth: 145 },
  axisLabel: {
    position: 'absolute',
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '700',
  },
  handleTarget: {
    position: 'absolute',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: { width: 23, height: 23, borderRadius: 12 },
  hint: { fontSize: 12, textAlign: 'center', minHeight: 18 },
  values: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  adjust: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 25 },
  readout: { alignItems: 'center', gap: 4, minWidth: 150 },
  number: { fontFamily: theme.mono('700'), fontSize: 32 },
  unit: { fontSize: 13 },
  reset: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  disclaimer: { fontSize: 11, lineHeight: 17, textAlign: 'center' },
  switcher: {
    position: 'absolute',
    bottom: 18,
    left: 20,
    right: 20,
    borderRadius: 32,
    borderWidth: 1,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  switchTitle: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  switchCaption: { fontSize: 8, letterSpacing: 1.5, textAlign: 'center', marginTop: 4 },
})
