// THROWAWAY: real native paging. All three sections stay mounted and follow the finger.
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NativeScrollGestureContext } from '@/components/gestures/NativeScrollGestureContext'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { TuneRingSectionTabs } from './TuneRingSectionTabs'
import { GROUPS } from './tuneRingControls'
import { TuneRingPrototype } from './TuneRingPrototype'
import { TuneRingTopBar, TuneRingProfileFooter, TuneRingVariantSwitcher } from './TuneRingChrome'
import { usePrototypeProfiles } from './usePrototypeProfiles'

function WorkspacePage({
  section,
  values,
  onChange,
  position,
  onPage,
  originalValues,
}: {
  section: number
  values: number[][]
  onChange: (values: number[][]) => void
  position: SharedValue<number>
  onPage: (page: number) => void
  originalValues: number[]
}) {
  'use no memo'
  const live = useSharedValue(values[section])
  useEffect(() => {
    live.set(values[section])
  }, [live, section, values])
  return (
    <TuneRingPrototype
      variant={4}
      onVariant={() => undefined}
      board={null}
      liveValues={live}
      embeddedPage={section}
      draft={values}
      onDraftChange={onChange}
      pagerPosition={position}
      onAdjacentPage={onPage}
      originalValues={originalValues}
    />
  )
}
export function TuneRingWorkspace({ onVariant }: { onVariant: (variant: number) => void }) {
  'use no memo'
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const neutral = useResolvedNeutralColors()
  const [page, setPage] = useState(0)
  const [values, setValues] = useState<number[][]>(() => GROUPS.map((group) => [...group.defaults]))
  const lab = usePrototypeProfiles(values, setValues)
  const pager = useRef<Animated.ScrollView>(null)
  const nativePager = Gesture.Native()
  const position = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => position.set(event.contentOffset.x),
    onMomentumEnd: (event) =>
      scheduleOnRN(setPage, Math.max(0, Math.min(2, Math.round(event.contentOffset.x / width)))),
  })
  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: neutral.bg }]}>
      <View style={styles.header}>
        <TuneRingTopBar enabled history={lab.history}>
          <TuneRingVariantSwitcher variant={6} label="Tune workspace" onVariant={onVariant} />
        </TuneRingTopBar>
      </View>
      <TuneRingSectionTabs
        page={page}
        position={position}
        pageWidth={width}
        style={styles.tabs}
        onPage={(target) => pager.current?.scrollTo({ x: target * width, animated: true })}
      />
      <NativeScrollGestureContext value={nativePager}>
        <GestureDetector gesture={nativePager}>
          <Animated.ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            directionalLockEnabled
            showsHorizontalScrollIndicator={false}
            bounces={false}
            removeClippedSubviews={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            style={styles.pager}
          >
            {GROUPS.map((group, index) => (
              <View
                key={group.name}
                style={{
                  width,
                  height: '100%',
                  overflow: 'visible',
                  zIndex: page === index ? 2 : 1,
                }}
                accessibilityElementsHidden={page !== index}
                importantForAccessibility={page !== index ? 'no-hide-descendants' : 'auto'}
              >
                <WorkspacePage
                  key={`${lab.activeId}-${lab.revision}-${index}`}
                  section={index}
                  originalValues={lab.savedValues[index]}
                  values={values}
                  onChange={setValues}
                  position={position}
                  onPage={(target) =>
                    pager.current?.scrollTo({ x: target * width, animated: true })
                  }
                />
              </View>
            ))}
          </Animated.ScrollView>
        </GestureDetector>
      </NativeScrollGestureContext>
      <TuneRingProfileFooter lab={lab} paddingBottom={Math.max(16, insets.bottom)} />
    </View>
  )
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8 },
  tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  pager: { flex: 1 },
})
