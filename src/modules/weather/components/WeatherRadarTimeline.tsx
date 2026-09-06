import { TargetIcon } from 'phosphor-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { MonoValue } from '@/components/base/MonoValue'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import {
  findClosestRainViewerFrameIndex,
  formatRainViewerFrameTime,
  useRainViewerRadarStore,
} from '@/modules/weather/store/rainViewerRadarStore'

const FRAME_INTERVAL_MS = 450
const INITIAL_FRAME_OFFSET_SECONDS = 30 * 60
const TIME_FONT_SIZE = 12

/** Same stroke the wrist draws its timeline with: a line, never a pill. */
const LINE_WIDTH = 2

function pickFrameIndexByX(x: number, width: number, frameCount: number): number {
  'worklet'
  if (width <= 0 || frameCount <= 1) return -1
  const fraction = Math.max(0, Math.min(1, x / width))
  return Math.round(fraction * (frameCount - 1))
}

function createRadarScrubGesture({
  enabled,
  frameCount,
  trackWidth,
  gestureFrameIndex,
  progress,
  commitManualFrame,
  setScrubbing,
}: {
  enabled: boolean
  frameCount: SharedValue<number>
  trackWidth: SharedValue<number>
  gestureFrameIndex: SharedValue<number>
  progress: SharedValue<number>
  commitManualFrame: (index: number) => void
  setScrubbing: (scrubbing: boolean) => void
}) {
  return Gesture.Pan()
    .enabled(enabled)
    .minDistance(0)
    .onBegin((event) => {
      'worklet'
      const nextIndex = pickFrameIndexByX(event.x, trackWidth.value, frameCount.value)
      if (nextIndex < 0) return
      cancelAnimation(progress)
      gestureFrameIndex.value = nextIndex
      progress.value = frameCount.value <= 1 ? 1 : nextIndex / (frameCount.value - 1)
      scheduleOnRN(setScrubbing, true)
      scheduleOnRN(commitManualFrame, nextIndex)
    })
    .onUpdate((event) => {
      'worklet'
      const nextIndex = pickFrameIndexByX(event.x, trackWidth.value, frameCount.value)
      if (nextIndex < 0 || nextIndex === gestureFrameIndex.value) return
      cancelAnimation(progress)
      gestureFrameIndex.value = nextIndex
      progress.value = frameCount.value <= 1 ? 1 : nextIndex / (frameCount.value - 1)
      scheduleOnRN(commitManualFrame, nextIndex)
    })
    .onFinalize(() => {
      'worklet'
      gestureFrameIndex.value = -1
      // Playback picks up from wherever the finger left it: with no transport controls, a scrub
      // that stopped the animation for good would leave the rider on a frozen frame.
      scheduleOnRN(setScrubbing, false)
    })
}

export function WeatherRadarTimeline() {
  const neutral = useResolvedNeutralColors()
  const frames = useRainViewerRadarStore((state) => state.frames)
  const fetchRadar = useRainViewerRadarStore((state) => state.fetch)
  const [scrubbing, setScrubbing] = useState(false)
  const frameCountRef = useRef(0)
  const frameIndexRef = useRef(0)
  const initialFrameSelectedRef = useRef(false)
  const labelsRef = useRef<string[]>([])
  const instantFrameIndexRef = useRef<number | null>(null)
  const frameCount = useSharedValue(0)
  const trackWidth = useSharedValue(0)
  const gestureFrameIndex = useSharedValue(-1)
  const progress = useSharedValue(1)
  const frameLabel = useSharedValue('Radar')

  useEffect(() => {
    fetchRadar()
  }, [fetchRadar])

  useEffect(() => {
    frameCountRef.current = frames.length
    frameCount.value = frames.length
    labelsRef.current = frames.map((frame) => formatRainViewerFrameTime(frame.time))

    let selectedFrameIndex = useRainViewerRadarStore.getState().selectedFrameIndex
    if (!initialFrameSelectedRef.current && frames.length > 0) {
      selectedFrameIndex = findClosestRainViewerFrameIndex(
        frames,
        Date.now() / 1_000 - INITIAL_FRAME_OFFSET_SECONDS,
      )
      initialFrameSelectedRef.current = true
      instantFrameIndexRef.current = selectedFrameIndex
      useRainViewerRadarStore.getState().setFrameIndex(selectedFrameIndex, 'auto')
    }

    frameIndexRef.current = Math.max(0, Math.min(frames.length - 1, selectedFrameIndex))
    progress.value = frames.length <= 1 ? 1 : frameIndexRef.current / (frames.length - 1)
    frameLabel.value = labelsRef.current[frameIndexRef.current] ?? 'Radar'
  }, [frameCount, frames, frameLabel, progress])

  useEffect(() => {
    const unsubscribe = useRainViewerRadarStore.subscribe((state, previous) => {
      if (state.selectedFrameIndex === previous.selectedFrameIndex) return
      frameIndexRef.current = state.selectedFrameIndex
      const nextProgress =
        state.frames.length <= 1 ? 1 : state.selectedFrameIndex / (state.frames.length - 1)
      const instant = instantFrameIndexRef.current === state.selectedFrameIndex
      instantFrameIndexRef.current = null
      progress.value = instant
        ? nextProgress
        : withTiming(nextProgress, {
            duration: FRAME_INTERVAL_MS,
            easing: Easing.linear,
          })
      frameLabel.value = labelsRef.current[state.selectedFrameIndex] ?? 'Radar'
    })

    return unsubscribe
  }, [frameLabel, progress])

  const commitManualFrame = useCallback((index: number) => {
    instantFrameIndexRef.current = index
    useRainViewerRadarStore.getState().setFrameIndex(index)
  }, [])

  useEffect(() => {
    if (scrubbing || frames.length <= 1) return undefined
    const interval = setInterval(() => {
      const liveFrameCount = frameCountRef.current
      if (liveFrameCount <= 1) return
      const nextIndex = (frameIndexRef.current + 1) % liveFrameCount
      frameIndexRef.current = nextIndex
      useRainViewerRadarStore.getState().setFrameIndex(nextIndex, 'auto')
    }, FRAME_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [frames.length, scrubbing])

  function handleTrackLayout(event: LayoutChangeEvent) {
    trackWidth.value = event.nativeEvent.layout.width
  }

  const scrubGesture = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- shared values are only read/written inside gesture worklets, not during render
      createRadarScrubGesture({
        enabled: frames.length > 1,
        frameCount,
        trackWidth,
        gestureFrameIndex,
        progress,
        commitManualFrame,
        setScrubbing,
      }),
    [commitManualFrame, frameCount, frames.length, gestureFrameIndex, progress, trackWidth],
  )

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }))

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TargetIcon size={16} color={theme.weather.rain} weight="duotone" />
        <Text style={[styles.title, { color: neutral.textSecondary }]}>Rain radar</Text>
      </View>
      <MonoValue
        text={frameLabel}
        size={TIME_FONT_SIZE}
        weight="800"
        color={neutral.textPrimary}
        align="center"
      />
      <GestureDetector gesture={scrubGesture}>
        <Animated.View
          accessibilityRole="adjustable"
          accessibilityLabel="Radar frame timeline"
          onLayout={handleTrackLayout}
          style={styles.track}
        >
          <View style={[styles.guide, { backgroundColor: neutral.border }]}>
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    gap: 8,
    marginHorizontal: 16,
    maxWidth: 300,
    width: '68%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  // Thin line, thick target: the stroke matches the wrist's timeline, but the row stays a
  // finger tall so a scrub does not have to be aimed at two pixels. The line rides at the top of
  // that row rather than its middle, so the time reads as the line's label instead of the
  // header's — the slack all falls below, where nothing else sits.
  track: {
    height: 20,
    justifyContent: 'flex-start',
    paddingTop: 4,
  },
  guide: {
    borderRadius: 999,
    height: LINE_WIDTH,
  },
  // Inside the guide, not beside it: as a sibling it was positioned against the track box and
  // drew as a second line above the guide instead of over it.
  fill: {
    backgroundColor: theme.palette.sky.color,
    borderRadius: 999,
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
})
