import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Animated, {
  Easing,
  cancelAnimation,
  makeMutable,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { Canvas, Group, Rect } from '@shopify/react-native-skia'

import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'

/**
 * A stripped-down stand-in for the history chart stack: same bottom-pinned box, same fixed drawing
 * surface, same toggling of rows in and out of the middle of a stack — with none of the data.
 *
 * The point is to make the transition itself measurable. Every variable the real stack fights is a
 * control here: which rows are on, how the reveal is driven, whether the rows are React views or
 * one Skia picture, and how slowly it all plays. If a mode looks wrong at 3 s it is wrong at 220 ms
 * too; it is just too fast to see there.
 *
 * Everything animates from wherever it currently is rather than from where the last transition
 * meant to start, so toggling a row on and straight back off retargets mid-flight instead of
 * snapping to the old frame first.
 */

const BLOCK_HEIGHT = 56
const BLOCK_GAP = 8
const SLOT = BLOCK_HEIGHT + BLOCK_GAP
/** Room for every row at once. The surface never resizes, so it is sized for the largest stack. */
const SURFACE_HEIGHT = SLOT * 5 - BLOCK_GAP
const STAGE_HEIGHT = SURFACE_HEIGHT + 40

/** A row waits for its room to open before fading in, and gives it up before the room closes. */
const FADE_IN_DELAY = 0.45
const FADE_IN = 0.55
const FADE_OUT = 0.4

const ROWS = [
  { key: 'speed', label: 'Speed', color: theme.palette.blue.color },
  { key: 'duty', label: 'Duty', color: theme.palette.teal.color },
  { key: 'motor', label: 'Motor °C', color: theme.palette.orange.color },
  { key: 'ctrl', label: 'Ctrl °C', color: theme.palette.red.color },
  { key: 'batt', label: 'Battery', color: theme.palette.green.color },
] as const

type RowKey = (typeof ROWS)[number]['key']

const MODES = ['none', 'container', 'slide'] as const
type Mode = (typeof MODES)[number]

const DURATIONS = ['220', '600', '1500', '3000'] as const

const easing = Easing.out(Easing.cubic)

interface Placed {
  key: RowKey
  label: string
  color: string
  /** Top of the row, in coordinates of the fixed surface. */
  y: number
}

/** Bottom-aligned inside a surface that never changes size, exactly like `computeChartLayout`. */
function place(visible: readonly (typeof ROWS)[number][]): { rows: Placed[]; height: number } {
  const height = visible.length === 0 ? 0 : visible.length * SLOT - BLOCK_GAP
  const top = SURFACE_HEIGHT - height
  return {
    rows: visible.map((row, index) => ({ ...row, y: top + index * SLOT })),
    height,
  }
}

interface LiveRow extends Placed {
  /**
   * Same value as {@link Placed.y}, carried as a shared value so the slot and the offset land on
   * the UI thread together. Split across a style prop and a shared value they would not: the
   * offset is written during render and the style only at commit, leaving a frame drawn with one
   * of the two already updated.
   */
  slotY: SharedValue<number>
  /** Distance below {@link LiveRow.slotY} the row is drawn at right now. Animated to 0. */
  offset: SharedValue<number>
  opacity: SharedValue<number>
  exiting: boolean
  exitTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Holds one entry per row that is on screen — including one on its way off, which no longer has a
 * place in the layout but still has to fade somewhere.
 */
function useStackLab(visible: readonly (typeof ROWS)[number][], mode: Mode, duration: number) {
  'use no memo'
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const live = useRef(new Map<RowKey, LiveRow>()).current
  const boxHeight = useSharedValue(0)
  const applied = useRef<string | null>(null)

  const { rows, height } = useMemo(() => place(visible), [visible])
  const signature = `${mode}|${duration}|${rows.map((row) => `${row.key}:${row.y}`).join(',')}`

  if (applied.current !== signature) {
    const first = applied.current == null
    applied.current = signature
    const instant = first || mode === 'none'

    for (const row of rows) {
      const existing = live.get(row.key)
      if (existing == null) {
        live.set(row.key, {
          ...row,
          slotY: makeMutable(row.y),
          offset: makeMutable(0),
          opacity: makeMutable(instant ? 1 : 0),
          exiting: false,
          exitTimer: null,
        })
        if (!instant) {
          const entry = live.get(row.key)!
          entry.opacity.value = withDelay(
            duration * FADE_IN_DELAY,
            withTiming(1, { duration: duration * FADE_IN, easing }),
          )
        }
        continue
      }
      if (existing.exitTimer != null) clearTimeout(existing.exitTimer)
      // Where the row is drawn today, so a retarget mid-flight starts from what is on screen.
      const shownY = existing.y + existing.offset.value
      existing.y = row.y
      existing.slotY.value = row.y
      existing.exiting = false
      existing.exitTimer = null
      cancelAnimation(existing.offset)
      cancelAnimation(existing.opacity)
      if (instant || mode !== 'slide') {
        existing.offset.value = 0
      } else {
        existing.offset.value = shownY - row.y
        existing.offset.value = withTiming(0, { duration, easing })
      }
      existing.opacity.value = instant ? 1 : withTiming(1, { duration: duration * FADE_IN, easing })
    }

    const wanted = new Set(rows.map((row) => row.key))
    for (const [key, entry] of live) {
      if (wanted.has(key) || entry.exiting) continue
      if (instant) {
        live.delete(key)
        continue
      }
      entry.exiting = true
      cancelAnimation(entry.opacity)
      entry.opacity.value = withTiming(0, { duration: duration * FADE_OUT, easing })
      entry.exitTimer = setTimeout(() => {
        live.delete(key)
        bump()
      }, duration * FADE_OUT)
    }

    if (instant) boxHeight.value = height
    else {
      cancelAnimation(boxHeight)
      boxHeight.value = withTiming(height, { duration, easing })
    }
  }

  useEffect(
    () => () => {
      for (const entry of live.values()) if (entry.exitTimer != null) clearTimeout(entry.exitTimer)
    },
    [live],
  )

  return { live: [...live.values()], boxHeight }
}

/**
 * Every animated value arrives as its own prop rather than on one row object, and that is load
 * bearing: a worklet closing over `row.offset.value` captures — and, in development, deep-freezes
 * — the whole `row`. The bookkeeping this hook keeps on that object would then be silently
 * unwritable, and each transition would measure against a stale slot.
 */
interface RowViewProps {
  label: string
  color: string
  slotY: SharedValue<number>
  offset: SharedValue<number>
  opacity: SharedValue<number>
}

function toRowProps(row: LiveRow): RowViewProps {
  return {
    label: row.label,
    color: row.color,
    slotY: row.slotY,
    offset: row.offset,
    opacity: row.opacity,
  }
}

function ViewRow({ label, color, slotY, offset, opacity }: RowViewProps) {
  'use no memo'
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: slotY.value + offset.value }],
  }))
  return (
    <Animated.View style={[styles.row, style, { height: BLOCK_HEIGHT, backgroundColor: color }]}>
      <Text style={styles.rowLabel}>{label}</Text>
    </Animated.View>
  )
}

function SkiaBlock({ color, slotY, offset, opacity }: RowViewProps) {
  'use no memo'
  const y = useDerivedValue(() => slotY.value + offset.value, [slotY, offset])
  return (
    <Group opacity={opacity}>
      <Rect x={0} y={y} width={2000} height={BLOCK_HEIGHT} color={color} />
    </Group>
  )
}

export default function StackLabScreen() {
  const [on, setOn] = useState<Record<RowKey, boolean>>({
    speed: true,
    duty: true,
    motor: true,
    ctrl: true,
    batt: true,
  })
  const [mode, setMode] = useState<Mode>('slide')
  const [duration, setDuration] = useState<number>(1500)
  const [renderer, setRenderer] = useState<'views' | 'skia'>('views')

  const visible = useMemo(() => ROWS.filter((row) => on[row.key]), [on])
  const { live, boxHeight } = useStackLab(visible, mode, duration)

  const containerStyle = useAnimatedStyle(() => ({ height: boxHeight.value }))

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ShowcaseCard
          name="Stack transition lab"
          controls={
            <>
              <ChipRow
                label="Mode"
                options={[...MODES]}
                selected={mode}
                onSelect={(v) => setMode(v as Mode)}
              />
              <ChipRow
                label="Duration"
                options={[...DURATIONS]}
                selected={String(duration)}
                onSelect={(v) => setDuration(Number(v))}
              />
              <ChipRow
                label="Renderer"
                options={['views', 'skia']}
                selected={renderer}
                onSelect={(v) => setRenderer(v as 'views' | 'skia')}
              />
              <View style={styles.toggles}>
                {ROWS.map((row) => (
                  <Pressable
                    key={row.key}
                    style={[
                      styles.toggle,
                      { borderColor: row.color },
                      on[row.key] && { backgroundColor: row.color },
                    ]}
                    onPress={() => setOn((prev) => ({ ...prev, [row.key]: !prev[row.key] }))}
                  >
                    <Text style={[styles.toggleText, on[row.key] && styles.toggleTextActive]}>
                      {row.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          }
        >
          <View style={styles.stage}>
            <Ruler />
            <Animated.View style={[styles.box, containerStyle]}>
              <View style={[styles.surface, { height: SURFACE_HEIGHT }]}>
                {renderer === 'views' ? (
                  live.map((row) => <ViewRow key={row.key} {...toRowProps(row)} />)
                ) : (
                  <Canvas style={[styles.canvas, { height: SURFACE_HEIGHT }]}>
                    {live.map((row) => (
                      <SkiaBlock key={row.key} {...toRowProps(row)} />
                    ))}
                  </Canvas>
                )}
              </View>
            </Animated.View>
          </View>
        </ShowcaseCard>
      </ScrollView>
    </SafeAreaView>
  )
}

function Ruler() {
  const lines = []
  for (let y = 0; y <= SURFACE_HEIGHT; y += 32) lines.push(y)
  return (
    <View pointerEvents="none" style={styles.ruler}>
      {lines.map((y) => (
        <View key={y} style={[styles.rulerLine, { bottom: y }]}>
          <Text style={styles.rulerText}>{y}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 16, gap: 8 },
  stage: {
    height: STAGE_HEIGHT,
    justifyContent: 'flex-end',
    backgroundColor: theme.palette.slate.bg,
    borderRadius: 8,
    overflow: 'hidden',
  },
  box: {
    overflow: 'hidden',
    justifyContent: 'flex-end',
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
  },
  surface: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  canvas: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  row: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    borderRadius: 6,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  rowLabel: { color: theme.palette.slate.bg, fontSize: 11, fontWeight: '800' },
  ruler: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  rulerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.palette.slate.border,
  },
  rulerText: { position: 'absolute', right: 2, bottom: 0, fontSize: 8, color: '#64748b' },
  toggles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 4 },
  toggle: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  toggleText: { fontSize: 11, color: theme.palette.slate.textSecondary },
  toggleTextActive: { color: theme.palette.slate.bg, fontWeight: '800' },
})
