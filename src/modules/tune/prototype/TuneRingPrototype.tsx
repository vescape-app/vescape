// THROWAWAY: compare a human-facing 0–10 scale with real tune editor ranges.
import { use, useState, type ReactNode } from 'react'
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Svg, { Circle, Defs, Line } from 'react-native-svg'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'
import { Text } from '@/components/base/Text'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'

import { TuneDial } from '@/modules/tune/components/TuneDial'
import { FieldEditorPopover } from '@/modules/tune/components/FieldEditorPopover'
import { TuneRingNavigation, TuneRingVariantSwitcher } from './TuneRingChrome'
import { NativeScrollGestureContext } from '@/components/gestures/NativeScrollGestureContext'
import { TuneRingSideTargets } from './TuneRingSideTargets'
import { TuneRingParallaxLayer, TuneRingSavedCircle } from './TuneRingParallaxLayer'
import { TuneRingSectionTabs } from './TuneRingSectionTabs'
import { RingResizeGesture } from './RingResizeGesture'
import { RingHandle } from './RingHandle'
import { TuneRingParameterLabel } from './TuneRingParameterLabel'
import { TuneRingGradient } from './TuneRingGradient'
import { TuneRingPresets } from './TuneRingPresets'
import { TuneRingFeelGuide } from './TuneRingFeelGuide'
import { usePrototypeTuneEditor } from './usePrototypeTuneEditor'
import { controlsForVariant, GROUPS, realValue } from './tuneRingControls'
import { ANGLES, handleCircle, valueRadius, constrainCircleEdit } from './tuneRingGeometry'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

const VARIANTS = [
  'Simple · 0–10',
  'Real ranges',
  'Graph only',
  'Graph · no board',
  'Graph · resize',
  'Tune workspace',
] as const
const bound = (n: number) => Math.max(0, Math.min(100, n))

export function TuneRingPrototype({
  variant,
  onVariant,
  board,
  liveValues,
  embeddedPage,
  draft,
  onDraftChange,
  pagerPosition,
  onAdjacentPage,
  originalValues,
}: {
  variant: number
  onVariant: (variant: number) => void
  board: ReactNode
  liveValues: SharedValue<number[]>
  embeddedPage?: number
  draft?: number[][]
  onDraftChange?: (values: number[][]) => void
  pagerPosition?: SharedValue<number>
  onAdjacentPage?: (page: number) => void
  originalValues?: number[]
}) {
  'use no memo'
  const insets = useSafeAreaInsets()
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const [localPage, setPage] = useState(0)
  const page = embeddedPage ?? localPage
  const pagerGesture = use(NativeScrollGestureContext)
  const [activePreset, setActivePreset] = useState<string | null>(null)
  // Match colors to riding behavior across labels, handles, axes, and the dial.
  const pageColors = [
    [accents.blue, accents.cyan, accents.teal],
    [accents.red, accents.yellow, accents.orange],
    [accents.violet, accents.amber, accents.mint],
  ]
  const colors = [...pageColors[page].map((accent) => accent.color), accents.purple.color]
  const [selected, setSelected] = useState(0)
  const controls = controlsForVariant(variant)
  const [localValues, setLocalValues] = useState<number[][]>(() =>
    GROUPS.map((group) => [...group.defaults]),
  )
  const values = draft ?? localValues
  const setValues = (next: number[][] | ((current: number[][]) => number[][])) => {
    const result = typeof next === 'function' ? next(values) : next
    if (onDraftChange) onDraftChange(result)
    else setLocalValues(result)
  }
  const window = useWindowDimensions()
  const width = Math.min(window.width - 24, 420)
  const center = width / 2
  const radius = width * 0.36
  const current = GROUPS[page]
  const control = controls[page][selected]
  const normalizedSteps = controls[page].map((item) => (item.step / (item.max - item.min)) * 100)
  const goPage = (index: number) => {
    setPage(index)
    setSelected(0)
    liveValues.set(values[index])
  }
  const change = (index: number, value: number) => {
    setActivePreset(null)
    const next = values.map((group, i) =>
      i === page ? group.map((v, j) => (j === index ? bound(value) : v)) : group,
    )
    setValues(next)
    liveValues.set(next[page])
  }
  const editor = usePrototypeTuneEditor(change)
  const circleProps = useAnimatedProps(() => handleCircle(liveValues.value, radius, center))
  const dragCircle = useSharedValue({ cx: center, cy: center, r: radius })
  const commitMix = (mixed: number[]) => {
    editor.clear(page)
    setActivePreset(null)
    setValues((groups) => groups.map((group, i) => (i === page ? [...mixed] : group)))
  }
  const mixGesture = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      dragCircle.set(handleCircle(liveValues.value, radius, center))
    })
    .onUpdate((event) => {
      const initial = dragCircle.value
      const mixed = constrainCircleEdit(
        initial,
        {
          ...initial,
          cx: initial.cx + event.translationX,
          cy: initial.cy + event.translationY,
        },
        radius,
        center,
        normalizedSteps,
        liveValues.value[3],
      )
      if (mixed) liveValues.set(mixed)
    })
    .onEnd(() => {
      scheduleOnRN(commitMix, liveValues.value)
    })
  if (pagerGesture) mixGesture.blocksExternalGesture(pagerGesture)
  const mixPosition = useAnimatedStyle(() => {
    const circle = handleCircle(liveValues.value, radius, center)
    return { transform: [{ translateX: circle.cx - 22 }, { translateY: circle.cy - 22 }] }
  })

  const parameterLabel = (index: number, style: StyleProp<ViewStyle>) => (
    <TuneRingParameterLabel
      key={index}
      label={current.labels[index]}
      placement={index === 0 ? 'top' : 'bottom'}
      description={variant >= 3 ? controls[page][index].description : undefined}
      value={realValue(values[page][index], page, index, variant)}
      liveValues={liveValues}
      index={index}
      range={controls[page][index]}
      color={colors[index]}
      style={style}
      onPress={(ref) => {
        if (variant >= 3) editor.open(page, index, values[page][index], ref, colors[index])
        else setSelected(index)
      }}
    />
  )
  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: embeddedPage == null ? neutral.bg : 'transparent',
          paddingTop: embeddedPage == null ? insets.top : 0,
        },
      ]}
    >
      <ScrollView
        style={embeddedPage != null ? styles.visibleOverflow : undefined}
        removeClippedSubviews={false}
        scrollEnabled={embeddedPage == null}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: variant >= 3 ? 4 : 24 + insets.bottom },
        ]}
      >
        {embeddedPage == null && (
          <>
            <TuneRingVariantSwitcher
              variant={variant}
              label={VARIANTS[variant - 1]}
              onVariant={onVariant}
            />
            <TuneRingSectionTabs page={page} onPage={goPage} />
          </>
        )}
        {variant >= 3 && (
          <View style={embeddedPage != null ? styles.guideSlot : undefined}>
            <TuneRingFeelGuide page={page} color={pageColors[page][0].color} />
          </View>
        )}
        {variant >= 3 &&
          parameterLabel(
            0,
            embeddedPage != null
              ? [styles.topParameter, styles.topParameterSlot]
              : styles.topParameter,
          )}
        <View
          style={{
            width,
            height:
              embeddedPage != null
                ? width - 6
                : variant >= 3
                  ? width + (page === 2 ? 30 : page === 1 ? 12 : -6)
                  : width - 8,
            alignSelf: 'center',
            marginTop:
              variant >= 3 ? -50 : Math.max(20, window.height / 2 - insets.top - 176 - width / 2),
          }}
        >
          <TuneRingParallaxLayer position={pagerPosition} section={page} pageWidth={window.width}>
            {variant < 4 && (
              <View
                pointerEvents="none"
                style={[styles.board, { left: center - 90, top: center - 90 }]}
              >
                {board}
              </View>
            )}
            <Svg width={width} height={width} pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Circle
                cx={center}
                cy={center}
                r={valueRadius(50, radius)}
                fill="none"
                stroke={neutral.textDim}
                strokeWidth={valueRadius(75, radius) - valueRadius(25, radius)}
                strokeOpacity={0.1}
              />
              <Circle
                cx={center}
                cy={center}
                r={radius}
                fill={pageColors[page][0].color}
                fillOpacity={0.03}
                stroke={neutral.textDim}
                strokeWidth={1}
                strokeOpacity={0.65}
              />
              <Defs>
                <TuneRingGradient id="stiffness" color={pageColors[page][0].color} />
              </Defs>
              <TuneRingSavedCircle
                values={originalValues}
                liveValues={liveValues}
                radius={radius}
                center={center}
                color={accents.yellow.color}
              />
              <AnimatedCircle
                animatedProps={circleProps}
                fill="url(#stiffness)"
                stroke={pageColors[page][0].color}
                strokeOpacity={0.5}
                strokeWidth={1}
              />
              {(variant >= 4 ? [0, 25, 50, 75] : [25, 50, 75]).map((percent) => (
                <Circle
                  key={percent}
                  cx={center}
                  cy={center}
                  r={valueRadius(percent, radius)}
                  fill="none"
                  stroke={neutral.textDim}
                  strokeWidth={1}
                  strokeOpacity={0.65}
                />
              ))}
              {ANGLES.slice(0, 3).map((angle, index) => (
                <Line
                  key={angle}
                  x1={center + Math.cos(angle) * 28}
                  y1={center + Math.sin(angle) * 28}
                  x2={center + Math.cos(angle) * radius}
                  y2={center + Math.sin(angle) * radius}
                  stroke={colors[index]}
                  strokeOpacity={0.65}
                  strokeWidth={1.5}
                  strokeDasharray="2 5"
                />
              ))}
            </Svg>
            <RingResizeGesture
              values={liveValues}
              radius={radius}
              center={center}
              steps={normalizedSteps}
              onCommit={commitMix}
            />
            {ANGLES.slice(0, 3).map((angle, index) => (
              <RingHandle
                key={`${page}-${variant}-${index}`}
                liveValues={liveValues}
                index={index}
                value={values[page][index]}
                angle={angle}
                radius={radius}
                center={center}
                normalizedStep={normalizedSteps[index]}
                range={{
                  min: controls[page][index].min,
                  max: controls[page][index].max,
                  now: realValue(values[page][index], page, index, variant),
                }}
                selected={variant < 3 && selected === index}
                color={colors[index]}
                label={current.labels[index]}
                onSelect={() => {
                  if (variant < 3) setSelected(index)
                }}
                onChange={(value) => {
                  editor.clear(page, index)
                  change(index, value)
                }}
              />
            ))}
            <GestureDetector gesture={mixGesture}>
              <Animated.View
                accessibilityLabel="Mix all three parameters"
                style={[styles.handleTarget, mixPosition]}
              >
                <View style={[styles.mixDot, { backgroundColor: pageColors[page][0].color }]} />
              </Animated.View>
            </GestureDetector>
          </TuneRingParallaxLayer>
          {variant < 3 &&
            [0, 1, 2].map((index) =>
              parameterLabel(
                index,
                index === 0
                  ? {
                      top: 0,
                      left: center - 85,
                      width: 170,
                    }
                  : {
                      top: center + radius * 0.62 + 17,
                      left: index === 1 ? 0 : width - 130,
                      width: 130,
                    },
              ),
            )}
          {variant >= 3 &&
            [1, 2].map((index) =>
              parameterLabel(index, {
                top: center + Math.sin(ANGLES[index]) * radius + 22,
                left: Math.max(
                  0,
                  Math.min(width - 140, center + Math.cos(ANGLES[index]) * (radius + 18) - 70),
                ),
                width: 140,
              }),
            )}
          {onAdjacentPage && (
            <TuneRingSideTargets
              page={page}
              center={center}
              radius={radius}
              onPage={onAdjacentPage}
            />
          )}
        </View>
        {embeddedPage == null && (
          <TuneRingPresets
            activePreset={activePreset}
            color={pageColors[page][0].color}
            onApply={(preset) => {
              const next = preset.values.map((group) => [...group])
              editor.clearAll()
              setValues(next)
              liveValues.set(next[page])
              setActivePreset(preset.name)
            }}
          />
        )}
        {variant < 3 && (
          <>
            <View style={styles.readout}>
              <Text style={[styles.stepLabel, { color: colors[selected] }]}>
                {current.name} · {current.labels[selected]}
              </Text>
              <Text style={{ color: neutral.textMuted, fontSize: 11 }}>
                {control.min} – {control.max}
                {control.unit ? ` ${control.unit}` : ''}
              </Text>
            </View>
            <TuneDial
              key={`${variant}-${page}-${selected}-${control.id}`}
              value={realValue(values[page][selected], page, selected, variant)}
              min={control.min}
              max={control.max}
              step={control.step}
              unit={control.unit}
              displayDecimals={control.step < 1 ? Math.ceil(-Math.log10(control.step)) : 0}
              valueChangeMode="live"
              color={colors[selected]}
              onValueChange={(value) => {
                editor.clear(page, selected)
                change(selected, ((value - control.min) / (control.max - control.min)) * 100)
              }}
            />
          </>
        )}
      </ScrollView>
      {embeddedPage == null && (
        <TuneRingNavigation
          page={page}
          onPage={goPage}
          paddingBottom={Math.max(insets.bottom, 16)}
        />
      )}
      <FieldEditorPopover target={editor.target} onCancel={editor.close} onApply={editor.apply} />
    </View>
  )
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 14 },
  topParameter: { position: 'relative', width: 220, alignSelf: 'center', marginTop: 12 },
  visibleOverflow: { overflow: 'visible' },
  guideSlot: { height: 88 },
  topParameterSlot: { height: 96, justifyContent: 'flex-end', marginTop: 4 },
  flex: { flex: 1 },
  board: { position: 'absolute', alignItems: 'center', width: 180, opacity: 0.4 },
  handleTarget: {
    position: 'absolute',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mixDot: { width: 9, height: 9, borderRadius: 5 },
  stepLabel: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  readout: { alignItems: 'center', gap: 4, minWidth: 150 },
})
