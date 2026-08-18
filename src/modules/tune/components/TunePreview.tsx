/* eslint-disable react-hooks/immutability */
import { useEffect, useMemo } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  Canvas,
  Circle,
  DashPathEffect,
  Line,
  Path,
  Skia,
  Text as SkiaText,
  vec,
} from '@shopify/react-native-skia'
import {
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import type { TuneProfileFieldValue } from 'vescape-core'

import { theme } from '@/constants/theme'
import { TunePreviewHeader } from '@/modules/tune/components/TunePreviewHeader'
import {
  CANVAS_HEIGHT,
  DECK_CENTER_Y,
  DECK_HALF_LENGTH,
  FOOTPAD_OFFSET,
  GROUND_TICK_SPACING,
  GROUND_TO_BOARD_BASELINE_Y,
  GROUND_Y,
  READOUT_FONT_SIZE,
  SPEED_FONT_SIZE,
  WHEEL_RADIUS,
  ZERO_MARKER_GAP,
  ZERO_MARKER_LENGTH,
  formatSignedDegrees,
  pitchInputArrow,
} from '@/modules/tune/components/tunePreviewCanvasGeometry'
import { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import {
  DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS,
  TUNE_PREVIEW_RESET_SPEED_KMH,
  TUNE_PREVIEW_MODEL_VERSION,
  calculateGroundToBoardAngleDegrees,
  createTunePreviewModel,
  createTunePreviewState,
  groundTravelToVisualOffset,
  stepTunePreview,
  type TunePreviewAdvancedPhysics,
  type TunePreviewParameters,
} from '@/modules/tune/lib/tunePreview'
import {
  terrainHeightRelativeToWheel,
  tunePreviewDeckLine,
} from '@/modules/tune/lib/tunePreviewGeometry'

interface TunePreviewProps {
  fields: Record<string, TuneProfileFieldValue>
  pitchInputDegrees: SharedValue<number>
  pitchInputActive: SharedValue<boolean>
  hillsEnabled?: boolean
  hillHeightMeters?: number
  hillSpacingMeters?: number
  active?: boolean
  onDisable?: () => void
  onHelp: () => void
  speedKmh?: SharedValue<number>
  groundToBoardAngleDegrees?: SharedValue<number>
}

interface TunePreviewScenario {
  parameters: TunePreviewParameters | null
  hillsEnabled: boolean
  hillHeightMeters: number
  hillSpacingMeters: number
  advancedPhysics: TunePreviewAdvancedPhysics
}

export const TUNE_PREVIEW_DESCRIPTION = 'Simulation for comparing Tune settings'

export function TunePreview({
  fields,
  pitchInputDegrees,
  pitchInputActive,
  hillsEnabled = false,
  hillHeightMeters = 2.5,
  hillSpacingMeters = 30,
  active = true,
  onDisable,
  onHelp,
  speedKmh,
  groundToBoardAngleDegrees,
}: TunePreviewProps) {
  const model = useMemo(
    () => createTunePreviewModel(fields),
    // Restart the animation loop after a model hot reload instead of retaining its old closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, TUNE_PREVIEW_MODEL_VERSION],
  )
  const parameters = model.status === 'ready' ? model.parameters : null
  const { width: canvasWidth } = useWindowDimensions()
  const centerX = canvasWidth / 2

  const state = useSharedValue(createTunePreviewState(TUNE_PREVIEW_RESET_SPEED_KMH))
  const scenario = useSharedValue<TunePreviewScenario>({
    parameters,
    hillsEnabled,
    hillHeightMeters,
    hillSpacingMeters,
    advancedPhysics: DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS,
  })
  const boardAngleStr = useSharedValue('0.0°')
  const targetAngleStr = useSharedValue('0.0°')
  const groundToBoardAngleStr = useSharedValue('0.0°')
  const speedStr = useSharedValue(TUNE_PREVIEW_RESET_SPEED_KMH.toFixed(1))
  const currentStr = useSharedValue('0 A')

  useEffect(() => {
    scenario.value = {
      parameters,
      hillsEnabled,
      hillHeightMeters,
      hillSpacingMeters,
      advancedPhysics: DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS,
    }
  }, [scenario, parameters, hillsEnabled, hillHeightMeters, hillSpacingMeters])

  // Physics and readouts run entirely on the UI runtime; the JS thread only syncs scenario props.
  const frameCallback = useFrameCallback((frame) => {
    'worklet'
    const { parameters: activeParameters, ...terrain } = scenario.value
    if (!activeParameters) return
    const dtSeconds = (frame.timeSincePreviousFrame ?? 0) / 1000
    if (dtSeconds <= 0) return
    const next = stepTunePreview(
      state.value,
      activeParameters,
      {
        pitchInputDegrees: pitchInputDegrees.value,
        pitchInputActive: pitchInputActive.value,
        speedKmh: state.value.syntheticSpeedKmh,
        hillsEnabled: terrain.hillsEnabled,
        hillHeightMeters: terrain.hillHeightMeters,
        hillSpacingMeters: terrain.hillSpacingMeters,
        advancedPhysics: terrain.advancedPhysics,
      },
      dtSeconds,
    )
    state.value = next
    const groundToBoardAngle = calculateGroundToBoardAngleDegrees(
      next.angleDegrees,
      next.terrainSlope,
    )
    if (groundToBoardAngleDegrees) groundToBoardAngleDegrees.value = groundToBoardAngle
    if (speedKmh) speedKmh.value = next.syntheticSpeedKmh
    const current = next.syntheticCurrentAmps
    boardAngleStr.value = formatSignedDegrees(next.angleDegrees)
    targetAngleStr.value = formatSignedDegrees(next.targetAngleDegrees)
    groundToBoardAngleStr.value = formatSignedDegrees(groundToBoardAngle)
    speedStr.value = next.syntheticSpeedKmh.toFixed(1)
    currentStr.value = `${current > 0 ? '+' : ''}${current.toFixed(0)} A`
  }, false)

  const running = active && parameters != null
  useEffect(() => {
    frameCallback.setActive(running)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  const deckPath = useDerivedValue(() => {
    const line = tunePreviewDeckLine(
      state.value.angleDegrees,
      centerX,
      DECK_CENTER_Y,
      DECK_HALF_LENGTH,
    )
    const path = Skia.Path.Make()
    path.moveTo(line.x1, line.y1)
    path.lineTo(line.x2, line.y2)
    return path
  })
  const targetPath = useDerivedValue(() => {
    const line = tunePreviewDeckLine(
      state.value.targetAngleDegrees,
      centerX,
      DECK_CENTER_Y,
      DECK_HALF_LENGTH,
    )
    const path = Skia.Path.Make()
    path.moveTo(line.x1, line.y1)
    path.lineTo(line.x2, line.y2)
    return path
  })
  const frontArrow = useDerivedValue(() =>
    pitchInputArrow(state.value.angleDegrees, pitchInputDegrees.value, centerX, -FOOTPAD_OFFSET),
  )
  const rearArrow = useDerivedValue(() =>
    pitchInputArrow(state.value.angleDegrees, pitchInputDegrees.value, centerX, FOOTPAD_OFFSET),
  )
  const frontArrowPath = useDerivedValue(() => frontArrow.value.path)
  const frontArrowOpacity = useDerivedValue(() => frontArrow.value.opacity)
  const rearArrowPath = useDerivedValue(() => rearArrow.value.path)
  const rearArrowOpacity = useDerivedValue(() => rearArrow.value.opacity)
  const ticksPath = useDerivedValue(() => {
    const path = Skia.Path.Make()
    if (scenario.value.hillsEnabled) return path
    const offset = groundTravelToVisualOffset(state.value.groundTravelMeters)
    const tickCount = Math.ceil(canvasWidth / GROUND_TICK_SPACING) + 1
    for (let index = 0; index < tickCount; index += 1) {
      const x = index * GROUND_TICK_SPACING + offset
      path.moveTo(x, GROUND_Y)
      path.lineTo(x - 4, GROUND_Y + 6)
    }
    return path
  })
  const terrainPath = useDerivedValue(() => {
    const path = Skia.Path.Make()
    const {
      hillsEnabled: hills,
      hillHeightMeters: height,
      hillSpacingMeters: spacing,
    } = scenario.value
    if (!hills) return path
    const travel = state.value.groundTravelMeters
    for (let x = 0; x <= canvasWidth; x += 6) {
      const y =
        GROUND_Y - terrainHeightRelativeToWheel(x - canvasWidth / 2, travel, height, spacing)
      if (x === 0) path.moveTo(x, y)
      else path.lineTo(x, y)
    }
    return path
  })

  const readoutFont = useSkiaMonoFont('500', READOUT_FONT_SIZE)
  const readoutBoldFont = useSkiaMonoFont('700', READOUT_FONT_SIZE)
  const speedFont = useSkiaMonoFont('700', SPEED_FONT_SIZE)
  const groundToBoardAngleX = useDerivedValue(() =>
    readoutBoldFont ? centerX - readoutBoldFont.getTextWidth(groundToBoardAngleStr.value) / 2 : 0,
  )

  return (
    <View style={styles.card}>
      {' '}
      <TunePreviewHeader
        speedStr={speedStr}
        boardAngleStr={boardAngleStr}
        targetAngleStr={targetAngleStr}
        currentStr={currentStr}
        speedFont={speedFont}
        readoutFont={readoutFont}
        readoutBoldFont={readoutBoldFont}
        onHelp={onHelp}
        onDisable={onDisable}
        description={TUNE_PREVIEW_DESCRIPTION}
      />
      {model.status === 'unsupported' ? (
        <View style={styles.unsupported}>
          <Text style={styles.unsupportedTitle}>Preview unavailable</Text>
          <Text style={styles.unsupportedText}>Missing: {model.missingFields.join(', ')}</Text>
        </View>
      ) : (
        <View style={styles.canvasWrap}>
          <Canvas style={styles.canvas} accessibilityLabel="Board angle preview">
            <Line
              p1={vec(
                centerX - DECK_HALF_LENGTH - ZERO_MARKER_GAP - ZERO_MARKER_LENGTH,
                DECK_CENTER_Y,
              )}
              p2={vec(centerX - DECK_HALF_LENGTH - ZERO_MARKER_GAP, DECK_CENTER_Y)}
              color={theme.palette.slate.textMuted}
              strokeWidth={1.5}
              strokeCap="round"
            />
            <Line
              p1={vec(centerX + DECK_HALF_LENGTH + ZERO_MARKER_GAP, DECK_CENTER_Y)}
              p2={vec(
                centerX + DECK_HALF_LENGTH + ZERO_MARKER_GAP + ZERO_MARKER_LENGTH,
                DECK_CENTER_Y,
              )}
              color={theme.palette.slate.textMuted}
              strokeWidth={1.5}
              strokeCap="round"
            />
            <Path
              path={targetPath}
              style="stroke"
              color={theme.palette.purple.light}
              strokeWidth={1}
            >
              <DashPathEffect intervals={[6, 5]} />
            </Path>
            <Path
              path={deckPath}
              style="stroke"
              color={theme.palette.sky.color}
              strokeWidth={1}
              strokeCap="round"
            />
            <Path
              path={frontArrowPath}
              opacity={frontArrowOpacity}
              style="stroke"
              color={theme.palette.sky.color}
              strokeWidth={1.5}
              strokeCap="round"
              strokeJoin="round"
            />
            <Path
              path={rearArrowPath}
              opacity={rearArrowOpacity}
              style="stroke"
              color={theme.palette.sky.color}
              strokeWidth={1.5}
              strokeCap="round"
              strokeJoin="round"
            />
            <Circle
              cx={centerX}
              cy={GROUND_Y - WHEEL_RADIUS}
              r={WHEEL_RADIUS}
              color={theme.palette.slate.bg}
            />
            <Circle
              cx={centerX}
              cy={GROUND_Y - WHEEL_RADIUS}
              r={WHEEL_RADIUS}
              style="stroke"
              color={theme.palette.slate.textSecondary}
              strokeWidth={1}
            />
            <Path
              path={ticksPath}
              style="stroke"
              color={theme.palette.slate.textMuted}
              strokeWidth={1}
            />
            <Circle
              cx={centerX}
              cy={GROUND_Y - WHEEL_RADIUS}
              r={4}
              style="stroke"
              color={theme.palette.slate.border}
              strokeWidth={1}
            />
            {hillsEnabled ? (
              <Path
                path={terrainPath}
                style="stroke"
                color={theme.palette.slate.textMuted}
                strokeWidth={1}
              />
            ) : (
              <Line
                p1={vec(0, GROUND_Y)}
                p2={vec(canvasWidth, GROUND_Y)}
                color={theme.palette.slate.textMuted}
                strokeWidth={1}
              />
            )}
            {readoutBoldFont && (
              <SkiaText
                x={groundToBoardAngleX}
                y={GROUND_TO_BOARD_BASELINE_Y}
                text={groundToBoardAngleStr}
                font={readoutBoldFont}
                color={theme.palette.slate.textPrimary}
              />
            )}
          </Canvas>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {},
  canvasWrap: { position: 'relative', height: CANVAS_HEIGHT },
  canvas: { width: '100%', height: CANVAS_HEIGHT },
  unsupported: { height: CANVAS_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 5 },
  unsupportedTitle: { color: theme.palette.slate.textPrimary, fontSize: 13, fontWeight: '800' },
  unsupportedText: { color: theme.palette.slate.textMuted, fontSize: 11 },
})
