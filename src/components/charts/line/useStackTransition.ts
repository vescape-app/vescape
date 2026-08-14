import { useRef } from 'react'
import { Easing, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'

import type { ChartLayout } from '@/components/charts/line/chartLayout'

/** Long enough to read as movement, short enough that a metric toggle still feels immediate. */
export const STACK_TRANSITION_MS = 220

interface StackFrame {
  keys: string[]
  /** Distance from the bottom of the canvas to the top of each plot. */
  plotBottomYs: number[]
  canvasHeight: number
}

export interface StackTransition {
  /** 0 at the previous layout, 1 at the current one. */
  progress: SharedValue<number>
  /** Per chart: was it absent from the previous layout, and so should fade in. */
  entering: boolean[]
  fromHeight: number
  toHeight: number
}

/**
 * Open and close the room a stack needs, without moving what the rider is already reading.
 *
 * The panel is pinned to the bottom of the screen and the canvas is pinned to the bottom of the
 * panel, so the bottom edge is the one thing that never moves. Opening the Speed chart at the top
 * of the stack must not touch the four charts below it, and in bottom-relative terms those charts
 * did not move — so nothing inside the canvas is animated at all. The container alone grows, and
 * the charts above the newcomer are revealed as the room appears.
 *
 * Nothing here depends on the canvas repainting in the same frame as the layout commit, which it
 * does not: a Skia picture lands a frame or two late, and every scheme that animated the plots
 * themselves showed that lag as a jump.
 */
export function useStackTransition(keys: string[], layout: ChartLayout): StackTransition {
  // The whole hook is one deliberate render-phase side effect. Memoising it — by hand or by the
  // compiler — is what silently turns the animation off: a second pass over the same layout
  // compares the frame against itself, finds nothing moved, and cancels what it had just started.
  'use no memo'
  const progress = useSharedValue(1)
  // The signature is what makes the work below run exactly once per layout.
  const applied = useRef<{
    signature: string
    frame: StackFrame
    transition: StackTransition
  } | null>(null)

  const signature = `${keys.join(' ')}|${layout.canvasHeight}|${layout.plots
    .map((plot) => plot.y)
    .join(',')}`
  if (applied.current?.signature === signature) return applied.current.transition

  const before = applied.current?.frame ?? null
  const frame: StackFrame = {
    keys,
    plotBottomYs: layout.plots.map((plot) => layout.surfaceHeight - plot.y),
    canvasHeight: layout.canvasHeight,
  }

  const previousY = new Map(before?.keys.map((key, index) => [key, before.plotBottomYs[index]]))
  const moved = frame.plotBottomYs.some(
    (bottomY, index) => (previousY.get(keys[index]) ?? bottomY) !== bottomY,
  )
  const entering = keys.map((key) => before != null && !previousY.has(key))
  const fromHeight = before?.canvasHeight ?? frame.canvasHeight
  const changed =
    before != null && (fromHeight !== frame.canvasHeight || moved || entering.some(Boolean))

  // Kicked from render rather than from an effect on purpose: an effect would let one frame of
  // the finished layout reach the screen before the offsets apply, which is the flash this hook
  // exists to remove.
  if (changed) {
    progress.value = 0
    progress.value = withTiming(1, {
      duration: STACK_TRANSITION_MS,
      easing: Easing.out(Easing.cubic),
    })
  } else {
    progress.value = 1
  }

  const transition: StackTransition = {
    progress,
    entering: changed ? entering : entering.map(() => false),
    fromHeight: changed ? fromHeight : frame.canvasHeight,
    toHeight: frame.canvasHeight,
  }
  applied.current = { signature, frame, transition }
  return transition
}
