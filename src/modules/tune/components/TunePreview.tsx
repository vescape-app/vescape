/* eslint-disable react-hooks/immutability */
import { useEffect, useMemo } from 'react'
import { Pressable, StyleSheet, Switch, View, useWindowDimensions } from 'react-native'
import { Text } from '@/components/base/Text'
import { EyeIcon, QuestionIcon } from 'phosphor-react-native'
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
import { useSkiaMonoFont } from '@/hooks/useSkiaFont'
import {
  useResolvedAccentColors,
  useResolvedNeutralColors,
  useResolvedTelemetryColors,
} from '@/hooks/useTheme'
import {
  DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS,
  MAX_PITCH_INPUT_DEGREES,
  MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND,
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
  GROUND_TICK_SPACING_METERS,
  TUNE_PREVIEW_PIXELS_PER_METER,
  TUNE_PREVIEW_WHEEL_RADIUS_PIXELS,
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
  advancedPhysics?: TunePreviewAdvancedPhysics
  active?: boolean
  onDisable?: () => void
  onHelp: () => void
  hillLoadAmps?: SharedValue<number>
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

const GROUND_Y = 58
const WHEEL_RADIUS = TUNE_PREVIEW_WHEEL_RADIUS_PIXELS
const DECK_HALF_LENGTH = 72
const DECK_CENTER_Y = GROUND_Y - WHEEL_RADIUS
const ZERO_MARKER_GAP = 6
const ZERO_MARKER_LENGTH = 12
const GROUND_TICK_SPACING = GROUND_TICK_SPACING_METERS * TUNE_PREVIEW_PIXELS_PER_METER
const FOOTPAD_OFFSET = 46
const INPUT_ARROW_IDLE_GAP = 34
const INPUT_ARROW_TRAVEL = 18
const INPUT_ARROW_LENGTH = 16
const INPUT_ARROW_HEAD = 4
const CANVAS_HEIGHT = 122

// TextInput-based readouts crashed the app: every animatedProps text update chains a new
// AndroidTextInputState shadow state, and releasing the accumulated chain overflows the GC
// thread stack. Skia text draws bypass the shadow tree entirely.
const READOUT_FONT_SIZE = 9
const READOUT_BASELINE = 9
const READOUT_HEIGHT = 12
const LEGEND_VALUE_WIDTH = 44
const SPEED_FONT_SIZE = 16
const SPEED_BASELINE = 17
const SPEED_WIDTH = 38
const SPEED_HEIGHT = 20
const GROUND_TO_BOARD_BASELINE_Y = CANVAS_HEIGHT - 32

export function TunePreview({
  fields,
  pitchInputDegrees,
  pitchInputActive,
  hillsEnabled = false,
  hillHeightMeters = 2.5,
  hillSpacingMeters = 30,
  advancedPhysics = DEFAULT_TUNE_PREVIEW_ADVANCED_PHYSICS,
  active = true,
  onDisable,
  onHelp,
  hillLoadAmps,
  speedKmh,
  groundToBoardAngleDegrees,
}: TunePreviewProps) {
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()
  const telemetry = useResolvedTelemetryColors()
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
    advancedPhysics,
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
      advancedPhysics,
    }
  }, [scenario, parameters, hillsEnabled, hillHeightMeters, hillSpacingMeters, advancedPhysics])

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
    if (hillLoadAmps) hillLoadAmps.value = next.terrainLoadCurrentAmps
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
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <View style={styles.identityRow}>
            <EyeIcon size={16} color={theme.tune.color} weight="duotone" />
            <View style={styles.identityText}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>Tune Preview</Text>
                <Pressable hitSlop={8} onPress={onHelp}>
                  <QuestionIcon size={14} color={theme.palette.slate.textMuted} weight="bold" />
                </Pressable>
              </View>
              <Text style={styles.subtitle}>{TUNE_PREVIEW_DESCRIPTION}</Text>
            </View>
            <View style={styles.speedReadout}>
              <Canvas style={styles.speedCanvas}>
                {speedFont && (
                  <SkiaText
                    x={0}
                    y={SPEED_BASELINE}
                    text={speedStr}
                    font={speedFont}
                    color={telemetry.speed}
                  />
                )}
              </Canvas>
              <Text style={styles.speedUnit}>km/h</Text>
            </View>
            {onDisable ? (
              <Switch
                value
                onValueChange={(enabled) => {
                  if (!enabled) onDisable()
                }}
                trackColor={{
                  false: neutral.border,
                  true: theme.alpha(accents.purple.color, 0.6),
                }}
                thumbColor={accents.purple.color}
                accessibilityLabel="Disable Tune Preview"
              />
            ) : null}
          </View>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={styles.boardSwatch} />
              <Text style={styles.boardLegendText}>Board </Text>
              <Canvas style={styles.legendValueCanvas}>
                {readoutFont && (
                  <SkiaText
                    x={0}
                    y={READOUT_BASELINE}
                    text={boardAngleStr}
                    font={readoutFont}
                    color={accents.sky.color}
                  />
                )}
              </Canvas>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.targetSwatch} />
              <Text style={styles.targetLegendText}>Target </Text>
              <Canvas style={styles.legendValueCanvas}>
                {readoutFont && (
                  <SkiaText
                    x={0}
                    y={READOUT_BASELINE}
                    text={targetAngleStr}
                    font={readoutFont}
                    color={accents.purple.light}
                  />
                )}
              </Canvas>
            </View>
          </View>
          <View style={styles.motorReadout}>
            <Text style={styles.motorLabel}>Motor</Text>
            <Canvas style={styles.legendValueCanvas}>
              {readoutFont && (
                <SkiaText
                  x={0}
                  y={READOUT_BASELINE}
                  text={currentStr}
                  font={readoutFont}
                  color={telemetry.motorCurrent}
                />
              )}
            </Canvas>
          </View>
        </View>
      </View>
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
            <Path path={targetPath} style="stroke" color={accents.purple.light} strokeWidth={1}>
              <DashPathEffect intervals={[6, 5]} />
            </Path>
            <Path
              path={deckPath}
              style="stroke"
              color={accents.sky.color}
              strokeWidth={1}
              strokeCap="round"
            />
            <Path
              path={frontArrowPath}
              opacity={frontArrowOpacity}
              style="stroke"
              color={accents.sky.color}
              strokeWidth={1.5}
              strokeCap="round"
              strokeJoin="round"
            />
            <Path
              path={rearArrowPath}
              opacity={rearArrowOpacity}
              style="stroke"
              color={accents.sky.color}
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

function formatSignedDegrees(value: number): string {
  'worklet'
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}°`
}

function pitchInputArrow(
  angleDegrees: number,
  pitchInputDegreesValue: number,
  centerX: number,
  footpadOffset: number,
) {
  'worklet'
  const normalized =
    Math.min(MAX_PITCH_INPUT_DEGREES, Math.max(-MAX_PITCH_INPUT_DEGREES, pitchInputDegreesValue)) /
    MAX_PITCH_INPUT_DEGREES
  const magnitude = Math.abs(normalized)
  const rate =
    Math.sign(normalized) * (1 - (1 - magnitude) ** 2) * MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND
  const sideRate = footpadOffset < 0 ? Math.max(-rate, 0) : Math.max(rate, 0)
  const progress = Math.min(1, Math.max(0, sideRate / MAX_PITCH_INPUT_RATE_DEGREES_PER_SECOND))
  const radians = (angleDegrees * Math.PI) / 180
  const footpadX = centerX + Math.cos(radians) * footpadOffset
  const footpadY = DECK_CENTER_Y + Math.sin(radians) * footpadOffset
  const arrowTop = footpadY - INPUT_ARROW_IDLE_GAP + INPUT_ARROW_TRAVEL * progress
  const arrowTip = arrowTop + INPUT_ARROW_LENGTH
  const headY = arrowTip - INPUT_ARROW_HEAD
  const opacity = progress <= 0 ? 0 : 0.18 + progress * 0.82

  const path = Skia.Path.Make()
  path.moveTo(footpadX, arrowTop)
  path.lineTo(footpadX, arrowTip)
  path.moveTo(footpadX - INPUT_ARROW_HEAD, headY)
  path.lineTo(footpadX, arrowTip)
  path.lineTo(footpadX + INPUT_ARROW_HEAD, headY)
  return { path, opacity }
}

const styles = StyleSheet.create({
  card: {},
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  titleBlock: { flex: 1, gap: 2 },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  speedReadout: {
    alignItems: 'flex-end',
    gap: 1,
  },
  speedCanvas: {
    width: SPEED_WIDTH,
    height: SPEED_HEIGHT,
  },
  speedUnit: {
    color: theme.palette.slate.textMuted,
    fontSize: 8,
    fontWeight: '700',
  },

  unsupported: { height: CANVAS_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 5 },
  unsupportedTitle: { color: theme.palette.slate.textPrimary, fontSize: 13, fontWeight: '800' },
  unsupportedText: { color: theme.palette.slate.textMuted, fontSize: 11 },
  legend: { alignItems: 'flex-start', gap: 2, marginTop: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  boardSwatch: { width: 18, height: 1, backgroundColor: theme.palette.sky.color },
  targetSwatch: {
    width: 18,
    height: 1,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.palette.purple.light,
  },
  boardLegendText: {
    color: theme.palette.sky.color,
    fontSize: 9,
  },
  targetLegendText: {
    color: theme.palette.purple.light,
    fontSize: 9,
  },
  motorReadout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  motorLabel: {
    color: theme.telemetry.motorCurrent,
    fontSize: 9,
  },
  legendValueCanvas: {
    width: LEGEND_VALUE_WIDTH,
    height: READOUT_HEIGHT,
  },
  canvasWrap: { position: 'relative', height: CANVAS_HEIGHT },
  canvas: { width: '100%', height: CANVAS_HEIGHT },
})
