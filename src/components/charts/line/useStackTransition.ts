import { useEffect, useReducer, useRef } from 'react'
import {
  Easing,
  cancelAnimation,
  makeMutable,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import type { ChartLayout } from '@/components/charts/line/chartLayout'

/** Long enough to read as movement, short enough that a metric toggle still feels immediate. */
export const STACK_TRANSITION_MS = 220

/** A chart waits for its room to open before fading in, and gives it up before the room closes. */
const FADE_IN_DELAY = 0.45
const FADE_IN = 0.55
const FADE_OUT = 0.4

const easing = Easing.out(Easing.cubic)

export interface StackRow {
  key: string
  /** Where this chart's plot sits in the current layout, in canvas coordinates. */
  slotY: SharedValue<number>
  /** How far below {@link StackRow.slotY} it is drawn right now. Animated to 0. */
  offset: SharedValue<number>
  opacity: SharedValue<number>
}

export interface StackTransition {
  /** Height of the box the stack is given — the only thing that changes size. */
  boxHeight: SharedValue<number>
  rows: Map<string, StackRow>
  /** Charts no longer in the layout that are still fading out, oldest slot first. */
  exiting: string[]
  /**
   * Charts whose opacity is actually moving right now.
   *
   * Only these should be drawn through an animated opacity: that is what puts a Skia group behind
   * a `saveLayer`, and a layer whose bounds are a frame behind the transform moving it gets culled
   * — the chart blinks out entirely rather than sliding. A chart that is only changing position
   * keeps a plain, fully opaque group.
   */
  fading: Set<string>
}

/**
 * The mutable half, deliberately kept off {@link StackRow}.
 *
 * A worklet freezes every object it captures, and a consumer reading `row.offset.value` captures
 * the row it read it from. What is handed out therefore holds shared values and nothing else:
 * freezing it changes nothing, and this bookkeeping — which the next transition is measured
 * against — stays writable no matter what the canvas closes over.
 */
interface RowState {
  /** JS-side copy of the slot, for measuring the next transition against. */
  y: number
  exiting: boolean
  exitTimer: ReturnType<typeof setTimeout> | null
  /** Its opacity is mid-animation, so it needs the layer a fade costs. */
  fading: boolean
  fadeTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Open and close the room a stack needs, without breaking what the rider is already reading.
 *
 * The panel is pinned to the bottom of the screen and the canvas to the bottom of the panel, so
 * the bottom edge is the one thing that never moves; the layout is bottom-aligned on a surface
 * that never resizes. A chart below the one being toggled therefore keeps its coordinates and does
 * not move at all. Charts above it do move — a slot's worth — and they travel on the same clock as
 * the box, starting from wherever they are currently drawn, so nothing jumps a slot ahead of the
 * room being made for it.
 *
 * Every value animates from its present position rather than from where the last transition meant
 * to start, which is what lets a toggle be reversed mid-flight.
 */
export function useStackTransition(keys: string[], layout: ChartLayout): StackTransition {
  // The whole hook is one deliberate render-phase side effect. Memoising it — by hand or by the
  // compiler — is what silently turns the animation off: a second pass over the same layout
  // compares the frame against itself, finds nothing moved, and cancels what it had just started.
  'use no memo'
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const rows = useRef(new Map<string, StackRow>()).current
  const state = useRef(new Map<string, RowState>()).current
  const boxHeight = useSharedValue(0)
  const applied = useRef<string | null>(null)

  const signature = `${layout.canvasHeight}|${keys
    .map((key, index) => `${key}:${layout.plots[index]?.y}`)
    .join(',')}`
  if (applied.current !== signature) {
    const first = applied.current == null
    applied.current = signature
    const duration = first ? 0 : STACK_TRANSITION_MS

    keys.forEach((key, index) => {
      const y = layout.plots[index]?.y ?? 0
      const row = rows.get(key)
      const was = state.get(key)
      if (row == null || was == null) {
        rows.set(key, {
          key,
          slotY: makeMutable(y),
          offset: makeMutable(0),
          opacity: makeMutable(first ? 1 : 0),
        })
        state.set(key, { y, exiting: false, exitTimer: null, fading: !first, fadeTimer: null })
        if (!first) {
          rows.get(key)!.opacity.value = withDelay(
            duration * FADE_IN_DELAY,
            withTiming(1, { duration: duration * FADE_IN, easing }),
          )
          state.get(key)!.fadeTimer = setTimeout(() => {
            const settled = state.get(key)
            if (settled == null || settled.exiting) return
            settled.fading = false
            settled.fadeTimer = null
            bump()
          }, duration)
        }
        return
      }
      // Where the chart is drawn today, so a toggle reversed mid-flight starts from the screen
      // rather than from the layout the interrupted transition was heading for.
      const drawnY = was.y + row.offset.value
      if (was.exitTimer != null) clearTimeout(was.exitTimer)
      was.y = y
      was.exiting = false
      was.exitTimer = null
      cancelAnimation(row.offset)
      row.slotY.value = y
      if (first) {
        row.offset.value = 0
        row.opacity.value = 1
      } else {
        row.offset.value = drawnY - y
        row.offset.value = withTiming(0, { duration, easing })
      }
      // Its opacity is only touched when it is not already whole: a chart that is merely being
      // moved must not pay for a layer, and must not be pushed back through one on the way out of
      // a reversed toggle either.
      if (first || row.opacity.value === 1) {
        cancelAnimation(row.opacity)
        row.opacity.value = 1
        was.fading = false
        if (was.fadeTimer != null) clearTimeout(was.fadeTimer)
        was.fadeTimer = null
      } else {
        cancelAnimation(row.opacity)
        was.fading = true
        row.opacity.value = withTiming(1, { duration: duration * FADE_IN, easing })
        if (was.fadeTimer != null) clearTimeout(was.fadeTimer)
        was.fadeTimer = setTimeout(() => {
          const settled = state.get(key)
          if (settled == null || settled.exiting) return
          settled.fading = false
          settled.fadeTimer = null
          bump()
        }, duration * FADE_IN)
      }
    })

    const wanted = new Set(keys)
    for (const [key, was] of state) {
      if (wanted.has(key) || was.exiting) continue
      if (first) {
        drop(rows, state, key)
        continue
      }
      // Kept mounted so the stack closes over a chart that has already faded, rather than over one
      // that vanished in a single frame.
      was.exiting = true
      was.fading = true
      const row = rows.get(key)!
      cancelAnimation(row.opacity)
      row.opacity.value = withTiming(0, { duration: duration * FADE_OUT, easing })
      was.exitTimer = setTimeout(() => {
        drop(rows, state, key)
        bump()
      }, duration * FADE_OUT)
    }

    console.log(
      '[st]',
      first ? 'first' : 'change',
      keys.join(','),
      'exiting',
      [...state.keys()].filter((k) => state.get(k)!.exiting).join(','),
      'h',
      boxHeight.value,
      '->',
      layout.canvasHeight,
    )
    cancelAnimation(boxHeight)
    if (first) boxHeight.value = layout.canvasHeight
    else boxHeight.value = withTiming(layout.canvasHeight, { duration, easing })
  }

  useEffect(
    () => () => {
      for (const was of state.values()) {
        if (was.exitTimer != null) clearTimeout(was.exitTimer)
        if (was.fadeTimer != null) clearTimeout(was.fadeTimer)
      }
    },
    [state],
  )

  const exiting: string[] = []
  const fading = new Set<string>()
  for (const [key, was] of state) {
    if (was.exiting) exiting.push(key)
    if (was.fading) fading.add(key)
  }
  return { boxHeight, rows, exiting, fading }
}

function drop(rows: Map<string, StackRow>, state: Map<string, RowState>, key: string) {
  const was = state.get(key)
  if (was?.fadeTimer != null) clearTimeout(was.fadeTimer)
  rows.delete(key)
  state.delete(key)
}
