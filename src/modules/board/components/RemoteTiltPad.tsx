import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { Canvas } from '@shopify/react-native-skia'
import { MonoText } from '@/components/base/MonoValue'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  ReduceMotion,
  useDerivedValue,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { theme } from '@/constants/theme'
import {
  createTiltPresentationOwner,
  TILT_CENTER,
  idleTiltPresentation,
  sampleTiltPresentation,
  type TiltPresentation,
} from '@/modules/board/lib/remoteTiltPresentation'
import { createTiltCommands } from '@/modules/board/lib/remoteTiltCommands'
import type { RemoteTiltState } from 'vescape-core'

const TILT_MAX = 255
const MAX_DECAY_MS = 60_000
const PAD_HEIGHT = 240
const THUMB_RADIUS = 14
const LOCK_BAND = 32
const TIME_MARKS = [1, 3, 8, 20, 40] as const
const TILT_MARKS = [-50, 50] as const
const TILT_LABELS = [-50, 0, 50] as const

function yForDecay(ms: number, height: number) {
  'worklet'
  return height - Math.sqrt(Math.min(1, Math.max(0, ms / MAX_DECAY_MS))) * (height - LOCK_BAND)
}

function xFractionForTilt(percent: number) {
  return (TILT_CENTER + (percent / 100) * (TILT_MAX - TILT_CENTER)) / TILT_MAX
}

interface RemoteTiltPadProps {
  disabled?: boolean
  connected?: boolean
  readState: () => Promise<RemoteTiltState | null>
  onChange: (value: number) => Promise<boolean>
  onRelease: (value: number, durationMs: number) => Promise<boolean>
  onLock: (value: number) => Promise<boolean>
  onCancel: () => Promise<boolean>
}

/** Native owns commands. This component owns one visual timeline, independent of telemetry. */
export function RemoteTiltPad({
  disabled = false,
  connected = true,
  readState,
  onChange,
  onRelease,
  onLock,
  onCancel,
}: RemoteTiltPadProps) {
  const owner = useMemo(createTiltPresentationOwner, [])
  const alive = useRef(true)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(false)
  const commands = useMemo(
    () =>
      createTiltCommands(() => {
        if (alive.current) setError('Tilt command failed. Check board connection.')
      }),
    [],
  )
  const presentation = useSharedValue<TiltPresentation>(idleTiltPresentation)
  const progress = useSharedValue(0)
  const width = useSharedValue(0)
  const tracking = useSharedValue(false)
  const fingerX = useSharedValue(0)
  const fingerY = useSharedValue(PAD_HEIGHT - THUMB_RADIUS)
  const fromY = useSharedValue(PAD_HEIGHT - THUMB_RADIUS)
  const lastSentAt = useSharedValue(0)
  const lastSentValue = useSharedValue(-1)

  const apply = useCallback(
    (next: TiltPresentation | null, preservePosition = false) => {
      if (!next || !alive.current || tracking.value) return
      const current = sampleTiltPresentation(presentation.value, progress.value)
      const y =
        presentation.value.phase === 'decaying'
          ? fromY.value + (PAD_HEIGHT - THUMB_RADIUS - fromY.value) * progress.value
          : fromY.value
      presentation.value =
        preservePosition && next.phase === 'decaying' ? { ...next, value: current.value } : next
      fromY.value =
        preservePosition && (next.phase === 'decaying' || next.phase === 'locked')
          ? y
          : next.phase === 'locked'
            ? LOCK_BAND / 2
            : next.phase === 'decaying'
              ? yForDecay(next.durationMs, PAD_HEIGHT)
              : PAD_HEIGHT - THUMB_RADIUS
      progress.value = 0
      if (next.phase === 'decaying')
        progress.value = withTiming(1, {
          duration: next.durationMs,
          easing: Easing.linear,
          reduceMotion: ReduceMotion.Never,
        })
      setActive(next.phase !== 'idle')
    },
    [fromY, presentation, progress, tracking],
  )

  useEffect(() => {
    alive.current = true
    let disposed = false
    let reading = false
    const refresh = async () => {
      const token = owner.readToken()
      if (reading || disposed || !connected || token === null) return
      reading = true
      try {
        const state = await readState()
        if (!disposed) apply(owner.refresh(state, token))
      } catch {
        if (!disposed && owner.readToken() === token) setError('Cannot refresh tilt state.')
      } finally {
        reading = false
      }
    }
    void refresh()
    const timer = setInterval(() => {
      void refresh()
    }, 100)
    return () => {
      disposed = true
      alive.current = false
      owner.invalidate()
      commands.clear()
      if (tracking.value) {
        tracking.value = false
        void commands(onCancel)
      }
      clearInterval(timer)
    }
  }, [apply, commands, connected, onCancel, owner, readState, tracking])

  const begin = useCallback(() => {
    owner.begin()
    setError(null)
    setActive(true)
  }, [owner])

  const hold = useCallback(
    (value: number) => {
      void commands(() => onChange(value), true)
    },
    [commands, onChange],
  )

  const finish = useCallback(
    async (value: number, durationMs: number, locked: boolean, cancel: boolean) => {
      const token = owner.pending()
      const accepted = await commands(() =>
        cancel ? onCancel() : locked ? onLock(value) : onRelease(value, durationMs),
      )
      try {
        const state = await readState()
        if (alive.current) apply(owner.accept(token, state), accepted)
      } catch {
        if (alive.current && owner.fail(token)) {
          setError('Cannot refresh tilt state.')
        }
      }
    },
    [apply, commands, onCancel, onLock, onRelease, owner, readState],
  )

  const cancel = useCallback(() => {
    tracking.value = false
    void finish(TILT_CENTER, 0, false, true)
  }, [finish, tracking])

  useEffect(() => {
    if (!connected) {
      commands.clear()
      tracking.value = false
      owner.invalidate()
      apply(idleTiltPresentation)
    } else if (disabled && tracking.value) cancel()
  }, [apply, cancel, commands, connected, disabled, owner, tracking])

  // Gesture samples stay on UI. Only the newest changed command crosses to JS at 10 Hz.
  useFrameCallback(({ timestamp }) => {
    if (!tracking.value || width.value <= 0 || timestamp - lastSentAt.value < 100) return
    const value = Math.round((fingerX.value / width.value) * TILT_MAX)
    lastSentAt.value = timestamp
    if (value === lastSentValue.value) return
    lastSentValue.value = value
    scheduleOnRN(hold, value)
  })

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .minDistance(0)
        .onStart((event) => {
          tracking.value = true
          progress.value = 0
          fingerX.value = Math.min(width.value, Math.max(0, event.x))
          fingerY.value = Math.min(PAD_HEIGHT, Math.max(0, event.y))
          lastSentValue.value = -1
          lastSentAt.value = 0
          scheduleOnRN(begin)
        })
        .onUpdate((event) => {
          fingerX.value = Math.min(width.value, Math.max(0, event.x))
          fingerY.value = Math.min(PAD_HEIGHT, Math.max(0, event.y))
        })
        .onFinalize((_event, success) => {
          if (!tracking.value || width.value <= 0) return
          const value = Math.round((fingerX.value / width.value) * TILT_MAX)
          const locked = fingerY.value <= LOCK_BAND
          const durationMs = Math.round(
            MAX_DECAY_MS * ((PAD_HEIGHT - fingerY.value) / (PAD_HEIGHT - LOCK_BAND)) ** 2,
          )
          tracking.value = false
          fromY.value = fingerY.value
          presentation.value = { value, durationMs, phase: 'pending' }
          progress.value = 0
          scheduleOnRN(finish, value, durationMs, locked, !success)
        }),
    [
      begin,
      disabled,
      fingerX,
      fingerY,
      finish,
      fromY,
      lastSentAt,
      lastSentValue,
      presentation,
      progress,
      tracking,
      width,
    ],
  )

  const thumbStyle = useAnimatedStyle(() => {
    const sample = sampleTiltPresentation(presentation.value, progress.value)
    return {
      transform: [
        { translateX: tracking.value ? fingerX.value : (sample.value / TILT_MAX) * width.value },
        {
          translateY: tracking.value
            ? fingerY.value
            : presentation.value.phase === 'decaying'
              ? fromY.value + (PAD_HEIGHT - THUMB_RADIUS - fromY.value) * progress.value
              : fromY.value,
        },
      ],
    }
  })
  const valueText = useDerivedValue(() => {
    const value =
      tracking.value && width.value > 0
        ? (fingerX.value / width.value) * TILT_MAX
        : sampleTiltPresentation(presentation.value, progress.value).value
    const percent = Math.round(((value - TILT_CENTER) / (TILT_MAX - TILT_CENTER)) * 100)
    const text = `${percent > 0 ? '+' : ''}${percent}%`
    return text
  })
  const timeText = useDerivedValue(() => {
    const sample = sampleTiltPresentation(presentation.value, progress.value)
    const seconds = (sample.remainingMs / 1000).toFixed(1)
    const selectedSeconds = (
      (MAX_DECAY_MS * ((PAD_HEIGHT - fingerY.value) / (PAD_HEIGHT - LOCK_BAND)) ** 2) /
      1000
    ).toFixed(1)
    const text = tracking.value
      ? fingerY.value <= LOCK_BAND
        ? 'release to lock'
        : `ease ${selectedSeconds}s`
      : presentation.value.phase === 'pending'
        ? 'Applying…'
        : presentation.value.phase === 'locked'
          ? 'LOCKED ∞'
          : presentation.value.phase === 'decaying' && progress.value < 1
            ? `RETURNING ${seconds}s`
            : presentation.value.phase === 'holding'
              ? 'ACTIVE'
              : 'ease 0.0s'
    return text
  })
  const readoutWidth = useDerivedValue(() => width.value)
  const onLayout = (event: LayoutChangeEvent) => {
    width.value = event.nativeEvent.layout.width
  }

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <View
          onLayout={onLayout}
          style={[styles.pad, disabled && styles.padDisabled]}
          collapsable={false}
        >
          {TILT_MARKS.map((percent) => (
            <View
              key={`v${percent}`}
              pointerEvents="none"
              style={[styles.gridLineV, { left: `${xFractionForTilt(percent) * 100}%` }]}
            />
          ))}
          <View pointerEvents="none" style={[styles.gridLineV, styles.centerLine]} />
          {TILT_LABELS.map((percent) => (
            <Text
              key={`vl${percent}`}
              pointerEvents="none"
              style={[
                styles.tiltLabel,
                percent === 0 && styles.zeroTiltLabel,
                { left: `${xFractionForTilt(percent) * 100}%` },
              ]}
            >
              {percent > 0 ? `+${percent}` : percent}%
            </Text>
          ))}
          {TIME_MARKS.map((sec) => (
            <View
              key={`h${sec}`}
              pointerEvents="none"
              style={[styles.gridLineH, { top: yForDecay(sec * 1000, PAD_HEIGHT) }]}
            >
              <Text style={styles.gridLabel}>{sec}s</Text>
            </View>
          ))}
          <View pointerEvents="none" style={styles.lockBand}>
            <Text style={styles.lockBandText}>lock</Text>
          </View>
          <Text pointerEvents="none" style={[styles.axisLabel, styles.axisTop]}>
            {(MAX_DECAY_MS / 1000).toFixed(0)}s
          </Text>
          <Animated.View
            pointerEvents="none"
            style={[styles.thumb, !active && styles.thumbRest, thumbStyle]}
          />
        </View>
      </GestureDetector>
      <Canvas style={styles.readout} pointerEvents="none">
        <MonoText
          text={valueText}
          size={16}
          color={theme.palette.sky.text}
          width={readoutWidth}
          height={24}
        />
        <MonoText
          text={timeText}
          size={14}
          color={theme.neutral.textSecondary}
          align="right"
          width={readoutWidth}
          height={24}
        />
      </Canvas>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.cancelRow}>
        <Button
          label="Cancel tilt"
          onPress={cancel}
          disabled={!active}
          variant="destructive"
          size="sm"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pad: {
    height: PAD_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surfaceDeep,
    overflow: 'hidden',
  },
  padDisabled: {
    opacity: 0.4,
  },
  lockBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: LOCK_BAND,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: theme.alpha(theme.palette.slate.light, 0.3),
    borderStyle: 'dashed',
  },
  lockBandText: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  gridLineV: {
    position: 'absolute',
    top: LOCK_BAND + 16,
    bottom: 0,
    width: 1,
    marginLeft: -0.5,
    backgroundColor: theme.alpha(theme.palette.slate.light, 0.3),
  },
  centerLine: {
    left: '50%',
    width: 2,
    marginLeft: -1,
    backgroundColor: theme.palette.sky.color,
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: theme.alpha(theme.palette.slate.light, 0.3),
  },
  gridLabel: {
    position: 'absolute',
    right: 6,
    top: 2,
    color: theme.neutral.textDim,
    fontSize: 9,
    fontWeight: '600',
  },
  tiltLabel: {
    position: 'absolute',
    top: LOCK_BAND + 3,
    width: 40,
    marginLeft: -20,
    textAlign: 'center',
    color: theme.neutral.textDim,
    fontSize: 9,
    fontWeight: '600',
  },
  zeroTiltLabel: {
    color: theme.palette.sky.text,
    fontWeight: '800',
  },
  axisLabel: {
    position: 'absolute',
    color: theme.neutral.textDim,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  axisTop: {
    top: LOCK_BAND + 4,
    right: 6,
  },
  thumb: {
    position: 'absolute',
    // Anchored at the pad origin; `translate` carries it, so the move stays transform-only.
    left: -THUMB_RADIUS,
    top: -THUMB_RADIUS,
    width: THUMB_RADIUS * 2,
    height: THUMB_RADIUS * 2,
    borderRadius: 999,
    backgroundColor: theme.palette.sky.color,
    borderWidth: 2,
    borderColor: theme.neutral.textPrimary,
  },
  thumbRest: {
    backgroundColor: theme.neutral.textMuted,
    borderColor: theme.neutral.border,
  },
  readout: {
    height: 24,
    marginTop: 8,
  },
  cancelRow: {
    alignItems: 'center',
    marginTop: 8,
  },
})
