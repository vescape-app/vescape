/* eslint-disable react-hooks/immutability */
// PROTOTYPE: large-canvas rail point generator selected from the explored A/B/C variants.
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import Svg, { Circle, G, Line, Path } from 'react-native-svg'
import {
  ArrowDownIcon,
  ClipboardTextIcon,
  CopyIcon,
  MinusIcon,
  PlusIcon,
} from 'phosphor-react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { Input } from '@/components/forms/Input'
import { theme } from '@/constants/theme'
import { BoardAttitudeIndicator } from '@/modules/board/components/BoardAttitudeIndicator'
import { PreviewAngleSlider } from '@/modules/board/components/PreviewAngleSlider'
import { RAIL_THICKNESS } from '@/modules/board/lib/boardAttitudeGeometry'
import {
  buildRailPath,
  sampleRailProfile,
  sampleRailValues,
  type RailPoint as Point,
} from '@/modules/board/lib/railProfile'

const WIDTH = 208
const HEIGHT = 70
const CENTER_Y = 32
const THUMB_SIZE = 18
function ValueSlider({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  'use no memo'
  const width = useSharedValue(0)
  const liveValue = useSharedValue(value)

  useEffect(() => {
    liveValue.value = value
  }, [liveValue, value])

  const gesture = useMemo(() => {
    const updateFromX = (x: number) => {
      'worklet'
      const travel = Math.max(width.value - THUMB_SIZE, 1)
      const thumbLeft = Math.max(0, Math.min(travel, x - THUMB_SIZE / 2))
      const next = Math.round(min + (thumbLeft / travel) * (max - min))
      if (next === liveValue.value) return
      liveValue.value = next
      scheduleOnRN(onChange, next)
    }

    return Gesture.Pan()
      .minDistance(0)
      .onBegin((event) => updateFromX(event.x))
      .onUpdate((event) => updateFromX(event.x))
  }, [liveValue, max, min, onChange, width])

  const thumbStyle = useAnimatedStyle(() => {
    const travel = Math.max(width.value - THUMB_SIZE, 0)
    const ratio = max === min ? 0 : (liveValue.value - min) / (max - min)
    return { transform: [{ translateX: Math.max(0, Math.min(1, ratio)) * travel }] }
  })

  const handleLayout = (event: LayoutChangeEvent) => {
    width.value = event.nativeEvent.layout.width
  }

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.sliderTouch} onLayout={handleLayout}>
        <View style={styles.sliderTrack} />
        <View style={styles.sliderCenterMark} />
        <Animated.View style={[styles.sliderThumb, thumbStyle]} />
      </View>
    </GestureDetector>
  )
}

function RailCanvas({
  points,
  smoothing,
  selected,
  onSelect,
  thickness,
  pointThicknesses,
  previewPoints,
  pitch,
  roll,
  yaw,
  large = false,
}: {
  points: readonly Point[]
  smoothing: readonly number[]
  selected: number
  onSelect: (index: number) => void
  thickness: number
  pointThicknesses: readonly number[]
  previewPoints: readonly Point[]
  pitch: ReturnType<typeof useSharedValue<number | null>>
  roll: ReturnType<typeof useSharedValue<number | null>>
  yaw: ReturnType<typeof useSharedValue<number | null>>
  large?: boolean
}) {
  const scale = large ? 1.55 : 1
  return (
    <View style={[styles.canvas, large && styles.canvasLarge]}>
      <View pointerEvents="none" style={styles.boardPreview}>
        <BoardAttitudeIndicator
          pitch={pitch}
          roll={roll}
          yaw={yaw}
          railPoints={previewPoints}
          railThickness={thickness}
          railPointThicknesses={pointThicknesses}
          railColorId="cyan"
          size={WIDTH * scale}
        />
      </View>
      <Svg width={WIDTH * scale} height={HEIGHT * scale} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <Line
          x1="0"
          y1={CENTER_Y}
          x2={WIDTH}
          y2={CENTER_Y}
          stroke={theme.neutral.border}
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <Circle cx="104" cy={CENTER_Y} r="2" fill={theme.neutral.textMuted} />
        <Path
          d={buildRailPath(points, smoothing)}
          fill="none"
          stroke={theme.palette.cyan.color}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map(([x, y], index) => (
          <G key={`${x}-${index}`}>
            <Circle
              cx={x}
              cy={y}
              r={13}
              fill={theme.neutral.bg}
              fillOpacity={0.01}
              onPress={() => onSelect(index)}
            />
            <Circle
              cx={x}
              cy={y}
              r={index === selected ? 4.5 : 3}
              fill={theme.neutral.bg}
              stroke={index === selected ? theme.palette.yellow.color : theme.palette.cyan.color}
              strokeWidth="2"
              onPress={() => onSelect(index)}
            />
          </G>
        ))}
      </Svg>
      <View style={styles.previewTopControl}>
        <Text style={styles.previewAxisLabel}>FRONT / BACK</Text>
        <PreviewAngleSlider value={yaw} />
      </View>
      <View style={styles.previewRightControl}>
        <Text style={styles.previewAxisLabel}>ROLL</Text>
        <PreviewAngleSlider value={roll} vertical />
      </View>
    </View>
  )
}

export function RailGeneratorPrototypeScreen() {
  const [points, setPoints] = useState<Point[]>([
    [14, CENTER_Y],
    [194, CENTER_Y],
  ])
  const [smoothing, setSmoothing] = useState([0, 0])
  const [thickness, setThickness] = useState(RAIL_THICKNESS)
  const [pointThicknesses, setPointThicknesses] = useState([RAIL_THICKNESS, RAIL_THICKNESS])
  const [selected, setSelected] = useState(0)
  const previewPoints = useMemo(() => sampleRailProfile(points, smoothing), [points, smoothing])
  const previewThicknesses = useMemo(
    () => sampleRailValues(points, pointThicknesses, previewPoints),
    [points, pointThicknesses, previewPoints],
  )
  const previewPitch = useSharedValue<number | null>(0)
  const previewRoll = useSharedValue<number | null>(25)
  const previewYaw = useSharedValue<number | null>(0)
  const output = JSON.stringify({
    points,
    smooth: smoothing,
    thickness,
    pointThickness: pointThicknesses,
  })
  const [presetText, setPresetText] = useState(output)
  const [presetError, setPresetError] = useState<string | null>(null)

  useEffect(() => setPresetText(output), [output])

  if (!__DEV__) return null

  const setHeight = (index: number, value: number) =>
    setPoints((current) =>
      current.map(([x, y], i) => (i === index ? ([x, CENTER_Y - value] as const) : [x, y])),
    )
  const setHorizontal = (index: number, value: number) =>
    setPoints((current) =>
      current.map(([x, y], i) => (i === index ? ([value, y] as const) : [x, y])),
    )
  const setCornerSmoothing = (index: number, value: number) =>
    setSmoothing((current) => current.map((amount, i) => (i === index ? value : amount)))
  const addPoint = () => {
    const gapIndex = selected === points.length - 1 ? selected - 1 : selected
    const left = points[gapIndex]!
    const right = points[gapIndex + 1]!
    if (right[0] - left[0] < 8) return
    const point: Point = [
      Math.round((left[0] + right[0]) / 2),
      Math.round((left[1] + right[1]) / 2),
    ]
    setPoints((current) => [
      ...current.slice(0, gapIndex + 1),
      point,
      ...current.slice(gapIndex + 1),
    ])
    setSmoothing((current) => [
      ...current.slice(0, gapIndex + 1),
      0,
      ...current.slice(gapIndex + 1),
    ])
    setPointThicknesses((current) => [
      ...current.slice(0, gapIndex + 1),
      Math.round((current[gapIndex]! + current[gapIndex + 1]!) / 2),
      ...current.slice(gapIndex + 1),
    ])
    setSelected(gapIndex + 1)
  }
  const removePoint = (removedIndex: number) => {
    if (points.length <= 2) return
    setPoints((current) => current.filter((_, index) => index !== removedIndex))
    setSmoothing((current) => current.filter((_, index) => index !== removedIndex))
    setPointThicknesses((current) => current.filter((_, index) => index !== removedIndex))
    setSelected((current) =>
      Math.max(0, Math.min(current - (removedIndex < current ? 1 : 0), points.length - 2)),
    )
  }
  const loadPreset = () => {
    try {
      const parsed = JSON.parse(presetText) as
        | Point[]
        | { points: Point[]; smooth?: number[]; thickness?: number; pointThickness?: number[] }
      const nextPoints = Array.isArray(parsed) ? parsed : parsed.points
      const nextSmoothing = Array.isArray(parsed) ? [] : (parsed.smooth ?? [])
      const nextThickness = Array.isArray(parsed)
        ? RAIL_THICKNESS
        : (parsed.thickness ?? RAIL_THICKNESS)
      const nextPointThicknesses = Array.isArray(parsed) ? undefined : parsed.pointThickness
      if (
        !Array.isArray(nextPoints) ||
        nextPoints.length < 2 ||
        nextPoints.some(
          (point) =>
            !Array.isArray(point) ||
            point.length !== 2 ||
            !Number.isFinite(point[0]) ||
            !Number.isFinite(point[1]),
        ) ||
        nextPoints.some(
          (point, index) =>
            point[0] < 4 ||
            point[0] > 204 ||
            point[1] < 18 ||
            point[1] > 46 ||
            (index > 0 && Math.round(point[0]) - Math.round(nextPoints[index - 1]![0]) < 4),
        ) ||
        !Number.isFinite(nextThickness) ||
        nextThickness < 12 ||
        nextThickness > 40 ||
        (nextPointThicknesses !== undefined &&
          (!Array.isArray(nextPointThicknesses) ||
            nextPointThicknesses.length !== nextPoints.length ||
            nextPointThicknesses.some(
              (value) => !Number.isFinite(value) || value < 12 || value > 40,
            )))
      ) {
        throw new Error('Preset needs ordered points inside the editor and thickness 12–40')
      }
      setPoints(nextPoints.map(([x, y]) => [Math.round(x), Math.round(y)] as const))
      setSmoothing(nextPoints.map((_, index) => Math.round(nextSmoothing[index] ?? 0)))
      setThickness(Math.round(nextThickness))
      setPointThicknesses(
        nextPoints.map((_, index) => Math.round(nextPointThicknesses?.[index] ?? nextThickness)),
      )
      setSelected(0)
      setPresetError(null)
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : 'Invalid preset')
    }
  }

  const insertionGap = selected === points.length - 1 ? selected - 1 : selected
  const canAddPoint = points[insertionGap + 1]![0] - points[insertionGap]![0] >= 8

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <RailCanvas
          points={points}
          smoothing={smoothing}
          selected={selected}
          onSelect={setSelected}
          thickness={thickness}
          pointThicknesses={previewThicknesses}
          previewPoints={previewPoints}
          pitch={previewPitch}
          roll={previewRoll}
          yaw={previewYaw}
          large
        />

        <View style={styles.actions}>
          <Button
            label="Add point"
            icon={PlusIcon}
            disabled={!canAddPoint}
            onPress={addPoint}
            style={styles.action}
          />
          <Button
            label="Remove point"
            icon={MinusIcon}
            variant="secondary"
            disabled={points.length <= 2}
            onPress={() => removePoint(selected)}
            style={styles.action}
          />
        </View>

        <View style={styles.controls}>
          <Text style={styles.controlLabel}>
            Point {selected + 1} · x {points[selected]?.[0]} · height{' '}
            {CENTER_Y - (points[selected]?.[1] ?? CENTER_Y)}
          </Text>
          <Text style={styles.sliderLabel}>Horizontal position</Text>
          <ValueSlider
            value={points[selected]?.[0] ?? 14}
            min={selected === 0 ? 4 : points[selected - 1]![0] + 4}
            max={selected === points.length - 1 ? 204 : points[selected + 1]![0] - 4}
            onChange={(value) => setHorizontal(selected, value)}
          />
          <Text style={styles.sliderLabel}>Height</Text>
          <ValueSlider
            value={CENTER_Y - (points[selected]?.[1] ?? CENTER_Y)}
            min={-14}
            max={14}
            onChange={(value) => setHeight(selected, value)}
          />
          <Text style={styles.sliderLabel}>Corner smoothing</Text>
          <ValueSlider
            value={smoothing[selected] ?? 0}
            min={0}
            max={100}
            onChange={(value) => setCornerSmoothing(selected, value)}
          />
          <Text style={styles.sliderLabel}>
            Point P{selected + 1} thickness · {pointThicknesses[selected]}
          </Text>
          <ValueSlider
            value={pointThicknesses[selected] ?? thickness}
            min={12}
            max={40}
            onChange={(value) =>
              setPointThicknesses((current) =>
                current.map((amount, index) => (index === selected ? value : amount)),
              )
            }
          />
          <Text style={styles.sliderLabel}>All points thickness · {thickness}</Text>
          <ValueSlider
            value={thickness}
            min={12}
            max={40}
            onChange={(value) => {
              setThickness(value)
              setPointThicknesses((current) => current.map(() => value))
            }}
          />
        </View>

        <View style={styles.output}>
          <Text style={styles.outputLabel}>PRESET · EDIT, COPY OR PASTE</Text>
          <Input
            value={presetText}
            onChangeText={(value) => {
              setPresetText(value)
              setPresetError(null)
            }}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.outputInput}
          />
          {presetError ? <Text style={styles.presetError}>{presetError}</Text> : null}
          <View style={styles.presetActions}>
            <Button
              label="Copy"
              icon={CopyIcon}
              size="sm"
              onPress={() => void Clipboard.setStringAsync(output)}
              style={styles.presetAction}
            />
            <Button
              label="Paste"
              icon={ClipboardTextIcon}
              size="sm"
              variant="secondary"
              onPress={() =>
                void Clipboard.getStringAsync().then((value) => {
                  setPresetText(value)
                  setPresetError(null)
                })
              }
              style={styles.presetAction}
            />
            <Button
              label="Load"
              icon={ArrowDownIcon}
              size="sm"
              variant="secondary"
              onPress={loadPreset}
              style={styles.presetAction}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 16, paddingBottom: 24, gap: 18 },
  canvas: { height: 132, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  canvasLarge: { height: 230 },
  boardPreview: { position: 'absolute', top: -52, alignSelf: 'center' },
  previewTopControl: { position: 'absolute', top: 0, left: 35, right: 35, alignItems: 'center' },
  previewRightControl: {
    position: 'absolute',
    top: 28,
    bottom: 12,
    right: 0,
    width: 30,
    alignItems: 'center',
  },
  previewAxisLabel: {
    color: theme.neutral.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
  controls: { gap: 14 },
  controlLabel: { color: theme.neutral.textSecondary, fontSize: 12, fontWeight: '700' },
  sliderLabel: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sliderTouch: {
    height: 30,
    justifyContent: 'center',
  },
  sliderTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.neutral.border,
  },
  sliderCenterMark: {
    position: 'absolute',
    left: '50%',
    width: 1,
    height: 10,
    backgroundColor: theme.neutral.textMuted,
  },
  sliderThumb: {
    position: 'absolute',
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2,
    borderColor: theme.neutral.textPrimary,
    backgroundColor: theme.palette.sky.color,
  },
  output: {
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  outputLabel: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  outputInput: { minHeight: 92, fontFamily: 'monospace', fontSize: 11 },
  presetError: { color: theme.status.error.text, fontSize: 11, fontWeight: '700' },
  presetActions: { flexDirection: 'row', gap: 8 },
  presetAction: { flex: 1 },
})
