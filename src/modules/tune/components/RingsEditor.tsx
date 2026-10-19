import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { ScrollView, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { router } from 'expo-router'
import { Text } from '@/components/base/Text'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { Button } from '@/components/base/Button'
import { NativeScrollGestureContext } from '@/components/gestures/NativeScrollGestureContext'
import { useResolvedAccentColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { routes } from '@/navigation/routes'
import {
  RING_CONTROLS,
  RING_PRESETS,
  RING_SECTIONS,
  projectRingControl,
  ringControlPatch,
  ringSectionPatch,
  type RingFields,
} from '../lib/ringModel'
import { APP_TUNE_FIELD_BY_ID } from '../lib/fields'
import { useRingMappingNoticeStore } from '../store/ringMappingNoticeStore'
import { useRingCalibrationStore } from '../store/ringCalibrationStore'
import { TuneRingSectionTabs } from './TuneRingSectionTabs'
import { TuneRingFeelGuide } from './TuneRingFeelGuide'
import { RingsChart } from './RingsChart'
import { FieldEditorPopover, type FieldEditorTarget } from './FieldEditorPopover'

export function RingsEditor({
  fields,
  savedFields,
  disabled = false,
  active = true,
  encodingScales = {},
  onPatch,
}: {
  fields: RingFields
  onPatch: (patch: Record<string, number>) => void
  savedFields: RingFields
  disabled?: boolean
  active?: boolean
  encodingScales?: Record<string, number | null | undefined>
}) {
  'use no memo'
  const { width: windowWidth } = useWindowDimensions()
  const [width, setWidth] = useState(windowWidth)
  const [viewportHeight, setViewportHeight] = useState(0)
  const neutral = useResolvedNeutralColors()
  const accents = useResolvedAccentColors()
  const anchors = useRingCalibrationStore((state) => state.anchors)
  const [page, setPage] = useState(0)
  const [guideHeights, setGuideHeights] = useState([100, 100, 100])
  const guideHeight = Math.max(100, ...guideHeights)
  const pager = useRef<Animated.ScrollView>(null)
  const lastWidth = useRef(width)
  const position = useSharedValue(0)
  useEffect(() => {
    if (lastWidth.current === width) return
    lastWidth.current = width
    position.set(page * width)
    pager.current?.scrollTo({ x: page * width, animated: false })
  }, [page, width, position])
  const pagerGesture = Gesture.Native()
  const verticalGesture = Gesture.Native()
  const [editor, setEditor] = useState<{ target: FieldEditorTarget; control: number } | null>(null)
  const noticeOwner = useId()
  const { owner: mappingNoticeOwner, claim, release, dismiss } = useRingMappingNoticeStore()
  const dismissMappingInfo = () => dismiss(noticeOwner)
  const projections = RING_CONTROLS.map((_, control) =>
    projectRingControl(anchors, control, fields, encodingScales),
  )
  const baseline = RING_CONTROLS.map((_, control) =>
    projectRingControl(anchors, control, savedFields, encodingScales),
  )
  const hasApproximateMapping = projections.some(
    (projection) => projection.custom && !projection.unavailable,
  )
  useEffect(() => {
    if (active && hasApproximateMapping) claim(noticeOwner)
  }, [active, hasApproximateMapping, claim, mappingNoticeOwner, noticeOwner])
  useEffect(() => {
    if (!active) release(noticeOwner)
    return () => useRingMappingNoticeStore.getState().release(noticeOwner)
  }, [active, release, noticeOwner])
  const requestPatch = (patch: Record<string, number>) => {
    if (disabled) return false
    const changes = Object.fromEntries(
      Object.entries(patch).filter(([id, value]) => fields[id] !== value),
    )
    if (!Object.keys(changes).length) return false
    onPatch(changes)
    return true
  }
  const open = (control: number, triggerRef: RefObject<View | null>) => {
    const definition = RING_CONTROLS[control]
    const projection = projections[control]
    const turning = control === 5
    setEditor({
      control,
      target: {
        triggerRef,
        fieldId: `rings-${control}`,
        label: definition.label,
        description: definition.help,
        value: projection.value - (turning ? 5 : 0),
        min: turning ? -5 : 0,
        max: turning ? 5 : 10,
        step: 0.1,
        manualDecimals: 1,
        strictRange: true,
        unit: null,
        help: 'Editing the dial replaces only this control’s owned fields. Linked fields can be edited directly outside the usual range. Calibration changes never rewrite an existing draft.',
        linkedFields: definition.fields.map((id) => {
          const field = APP_TUNE_FIELD_BY_ID.get(id)!
          return {
            id,
            label: field.label,
            min: field.min,
            max: field.max,
            step: field.step ?? 0.001,
            unit: field.unit,
            currentValue: fields[id] as number,
            computeValue: (value) =>
              ringControlPatch(anchors, control, value + (turning ? 5 : 0), encodingScales)[id],
          }
        }),
      },
    })
  }
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => position.set(event.contentOffset.x),
    onMomentumEnd: (event) =>
      scheduleOnRN(setPage, Math.max(0, Math.min(2, Math.round(event.contentOffset.x / width)))),
  })
  return (
    <View style={{ flex: 1 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <TuneRingSectionTabs
        page={page}
        position={position}
        pageWidth={width}
        style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}
        onPage={(section) => {
          setPage(section)
          pager.current?.scrollTo({ x: section * width, animated: true })
        }}
      />
      <GestureDetector gesture={verticalGesture}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        >
          <NativeScrollGestureContext value={pagerGesture}>
            <GestureDetector gesture={pagerGesture}>
              <Animated.ScrollView
                ref={pager}
                horizontal
                pagingEnabled
                directionalLockEnabled
                bounces={false}
                onScroll={onScroll}
                scrollEventThrottle={16}
                showsHorizontalScrollIndicator={false}
                removeClippedSubviews={false}
                style={{ flexGrow: 0, overflow: 'visible' }}
              >
                {RING_SECTIONS.map((name, section) => {
                  const colors = [
                    [accents.blue.color, accents.cyan.color, accents.teal.color],
                    [accents.fuchsia.color, accents.red.color, accents.pink.color],
                    [accents.green.color, accents.orange.color, accents.yellow.color],
                  ][section]
                  const controls = [section * 3, section * 3 + 1, section * 3 + 2]
                  const values = controls.map((control) => projections[control].value * 10)
                  const unavailable = controls.some((control) => projections[control].unavailable)
                  return (
                    <View
                      key={name}
                      style={{
                        width,
                        minHeight: viewportHeight,
                        overflow: 'visible',
                        alignItems: 'center',
                        paddingTop: 12,
                        paddingBottom: 12,
                        zIndex: section === page ? 2 : 1,
                      }}
                      accessibilityElementsHidden={page !== section}
                      importantForAccessibility={page === section ? 'auto' : 'no-hide-descendants'}
                    >
                      <View style={{ paddingHorizontal: 16, width: '100%', height: guideHeight }}>
                        <View
                          onLayout={(event) => {
                            const measured = event.nativeEvent.layout.height
                            setGuideHeights((heights) =>
                              heights[section] === measured
                                ? heights
                                : heights.map((height, index) =>
                                    index === section ? measured : height,
                                  ),
                            )
                          }}
                        >
                          <TuneRingFeelGuide page={section} color={colors[0]} />
                        </View>
                      </View>
                      <View style={{ marginTop: 0 }}>
                        <RingsChart
                          values={values}
                          savedValues={
                            controls.some((control) => baseline[control].unavailable)
                              ? undefined
                              : controls.map((control) => baseline[control].value * 10)
                          }
                          size={Math.min(width - 24, 420)}
                          color={colors[0]}
                          referenceColor={accents.yellow.color}
                          axisColors={colors}
                          disabled={disabled}
                          unavailable={unavailable}
                          position={position}
                          section={section}
                          pageWidth={width}
                          projections={controls.map((control) => projections[control])}
                          onOpen={open}
                          scrollGesture={verticalGesture}
                          onChange={(next, axis) => {
                            const changed = controls.filter(
                              (control, i) =>
                                (axis == null || axis === i) &&
                                Math.abs(next[i] - values[i]) > 0.001,
                            )
                            return requestPatch(
                              Object.assign(
                                {},
                                ...changed.map((control) =>
                                  ringControlPatch(
                                    anchors,
                                    control,
                                    next[control % 3] / 10,
                                    encodingScales,
                                  ),
                                ),
                              ),
                            )
                          }}
                        />
                      </View>
                      <View
                        style={{
                          flex: 1,
                          justifyContent: 'center',
                          alignItems: 'center',
                          gap: 12,
                          paddingHorizontal: 16,
                          paddingVertical: 24,
                          width: '100%',
                        }}
                      >
                        <View
                          style={{
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            justifyContent: 'center',
                            gap: 8,
                          }}
                        >
                          {RING_PRESETS[section].map((preset) => (
                            <Button
                              key={preset.name}
                              label={preset.name}
                              testID={`ring-preset-${section}-${preset.name.toLowerCase().replaceAll(' ', '-')}`}
                              size="sm"
                              variant="secondary"
                              disabled={disabled || unavailable}
                              onPress={() => {
                                requestPatch(
                                  ringSectionPatch(anchors, section, preset.values, encodingScales),
                                )
                              }}
                            />
                          ))}
                          <Button
                            label="Calibration"
                            variant="secondary"
                            size="sm"
                            onPress={() => router.push(routes.settingsRingsCalibration)}
                          />
                        </View>
                      </View>
                    </View>
                  )
                })}
              </Animated.ScrollView>
            </GestureDetector>
          </NativeScrollGestureContext>
        </ScrollView>
      </GestureDetector>
      <FadeCardModal
        visible={active && mappingNoticeOwner === noticeOwner}
        onDismiss={dismissMappingInfo}
        title="Your tune in Rings"
        footer={<Button label="Got it" onPress={dismissMappingInfo} />}
      >
        <Text style={{ color: neutral.textSecondary }}>
          Rings shows your tune as a simple chart. Some settings cannot be represented exactly, so
          the points show an approximation. Your original settings have not been changed. Moving a
          point applies the app’s linked settings, which may differ from your original tune. You can
          keep the original values or edit them individually in Advanced.
        </Text>
      </FadeCardModal>
      <FieldEditorPopover
        target={editor?.target ?? null}
        onCancel={() => setEditor(null)}
        onApply={(value, linked) => {
          if (!editor) return
          const changedDial = value !== editor.target.value
          const normalized = value + (editor.control === 5 ? 5 : 0)
          if (changedDial && (normalized < 0 || normalized > 10)) return
          const patch = {
            ...(changedDial
              ? ringControlPatch(anchors, editor.control, normalized, encodingScales)
              : {}),
            ...linked,
          }
          if (changedDial) requestPatch(patch)
          else onPatch(patch)
          setEditor(null)
        }}
      />
    </View>
  )
}
