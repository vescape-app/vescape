import { PauseIcon, PlayIcon } from 'phosphor-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
  withTiming,
} from 'react-native-reanimated'

import { IconButton } from '@/components/base/IconButton'
import { MonoValue } from '@/components/base/MonoValue'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import {
  formatRainViewerFrameTime,
  useRainViewerRadarStore,
} from '@/modules/weather/store/rainViewerRadarStore'

const FRAME_INTERVAL_MS = 450
const TIME_FONT_SIZE = 12

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
}: {
  enabled: boolean
  frameCount: SharedValue<number>
  trackWidth: SharedValue<number>
  gestureFrameIndex: SharedValue<number>
  progress: SharedValue<number>
  commitManualFrame: (index: number) => void
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
      runOnJS(commitManualFrame)(nextIndex)
    })
    .onUpdate((event) => {
      'worklet'
      const nextIndex = pickFrameIndexByX(event.x, trackWidth.value, frameCount.value)
      if (nextIndex < 0 || nextIndex === gestureFrameIndex.value) return
      cancelAnimation(progress)
      gestureFrameIndex.value = nextIndex
      progress.value = frameCount.value <= 1 ? 1 : nextIndex / (frameCount.value - 1)
      runOnJS(commitManualFrame)(nextIndex)
    })
    .onFinalize(() => {
      'worklet'
      gestureFrameIndex.value = -1
    })
}

export function WeatherRadarTimeline() {
  const neutral = useResolvedNeutralColors()
  const frames = useRainViewerRadarStore((state) => state.frames)
  const loading = useRainViewerRadarStore((state) => state.loading)
  const fetchRadar = useRainViewerRadarStore((state) => state.fetch)
  const [playing, setPlaying] = useState(true)
  const frameCountRef = useRef(0)
  const frameIndexRef = useRef(0)
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

    const selectedFrameIndex = useRainViewerRadarStore.getState().selectedFrameIndex
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
    setPlaying(false)
    instantFrameIndexRef.current = index
    useRainViewerRadarStore.getState().setFrameIndex(index)
  }, [])

  useEffect(() => {
    if (!playing || frames.length <= 1) return undefined
    const interval = setInterval(() => {
      const frameCount = frameCountRef.current
      if (frameCount <= 1) return
      const nextIndex = (frameIndexRef.current + 1) % frameCount
      frameIndexRef.current = nextIndex
      useRainViewerRadarStore.getState().setFrameIndex(nextIndex, 'auto')
    }, FRAME_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [frames.length, playing])

  const frameWindowLabel = useMemo(() => {
    const first = frames[0]
    const last = frames[frames.length - 1]
    if (!first || !last) return loading ? 'Loading' : 'No frames'
    return `${formatRainViewerFrameTime(first.time)}-${formatRainViewerFrameTime(last.time)}`
  }, [frames, loading])

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
      }),
    [commitManualFrame, frameCount, frames.length, gestureFrameIndex, progress, trackWidth],
  )

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }))

  const thumbStyle = useAnimatedStyle(() => ({
    left: `${progress.value * 100}%`,
  }))

  return (
    <View
      style={[styles.container, { backgroundColor: neutral.surface, borderColor: neutral.border }]}
    >
      <IconButton
        icon={playing ? PauseIcon : PlayIcon}
        size="sm"
        accessibilityLabel={playing ? 'Pause radar animation' : 'Play radar animation'}
        disabled={frames.length <= 1}
        onPress={() => setPlaying((value) => !value)}
      />
      <View style={styles.timeline}>
        <View style={styles.timelineHeader}>
          <MonoValue
            text={frameLabel}
            size={TIME_FONT_SIZE}
            weight="800"
            color={neutral.textPrimary}
            style={styles.timeText}
          />
          <Text style={[styles.rangeText, { color: neutral.textSecondary }]}>
            {frameWindowLabel}
          </Text>
        </View>
        <GestureDetector gesture={scrubGesture}>
          <Animated.View
            accessibilityRole="adjustable"
            accessibilityLabel="Radar frame timeline"
            onLayout={handleTrackLayout}
            style={styles.track}
          >
            <Animated.View style={[styles.fill, fillStyle]} />
            <Animated.View style={[styles.thumb, thumbStyle]} />
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    maxWidth: 520,
    padding: 8,
    width: '92%',
  },
  timeline: {
    flex: 1,
    gap: 6,
  },
  timelineHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    width: 64,
  },
  rangeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  track: {
    height: 18,
    justifyContent: 'center',
  },
  fill: {
    backgroundColor: theme.palette.sky.color,
    borderRadius: 999,
    height: 3,
  },
  thumb: {
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderColor: theme.palette.sky.light,
    borderRadius: 6,
    borderWidth: 2,
    height: 12,
    marginLeft: -6,
    position: 'absolute',
    width: 12,
  },
})
