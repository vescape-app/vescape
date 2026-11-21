import {
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import {
  edgeDrawerDismissOpacity,
  edgeDrawerHasCommitted,
  edgeDrawerPastEdge,
  edgeDrawerVisibleFraction,
} from '@/components/overlays/edgeDrawerDismiss'

const DRAWER_OPEN_TRANSLATE_Y = 42
const CHROME_FADE_DISTANCE = 240

/* eslint-disable react-hooks/immutability */
export function useDrawerScrollAnimation({
  openingScrollTarget,
  scrollOffset,
  dismissArmed,
  dismissTriggered,
  dragFromEdge,
  dragging,
  flingGuard,
  chromeDrag,
  restoreFullyVisible,
  animatedDismissRange,
  height,
  opensFromTop,
  presence,
  close,
  finishOpeningScroll,
}: {
  openingScrollTarget: SharedValue<number>
  scrollOffset: SharedValue<number>
  dismissArmed: SharedValue<boolean>
  dismissTriggered: SharedValue<boolean>
  dragFromEdge: SharedValue<boolean>
  dragging: SharedValue<boolean>
  flingGuard: SharedValue<boolean>
  chromeDrag: SharedValue<number>
  restoreFullyVisible: () => void
  animatedDismissRange: SharedValue<number>
  height: number
  opensFromTop: boolean
  presence: SharedValue<number>
  close: () => void
  finishOpeningScroll: () => void
}) {
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const offset = event.contentOffset.y
      if (openingScrollTarget.value >= 0) {
        if (Math.abs(offset - openingScrollTarget.value) > 1) return
        openingScrollTarget.value = -1
        dismissArmed.value = true
        scheduleOnRN(finishOpeningScroll)
      }
      scrollOffset.value = offset
      animatedDismissRange.value = Math.max(1, event.contentSize.height - height)
      const geometry = { offset, range: animatedDismissRange.value, height, opensFromTop }

      if (flingGuard.value && edgeDrawerPastEdge(geometry)) {
        flingGuard.value = false
        scheduleOnRN(restoreFullyVisible)
      }
      if (!dismissArmed.value || dismissTriggered.value || !dragFromEdge.value) return
      if (!dragging.value) return

      const fraction = edgeDrawerVisibleFraction(geometry)
      if (edgeDrawerHasCommitted(fraction)) {
        dismissTriggered.value = true
        scheduleOnRN(close)
      }
    },
  })

  const backdropStyle = useAnimatedStyle(() => {
    'worklet'
    const dismissed = edgeDrawerDismissOpacity(
      edgeDrawerVisibleFraction({
        offset: scrollOffset.value,
        range: animatedDismissRange.value,
        height,
        opensFromTop,
      }),
    )
    return { opacity: presence.value * dismissed * chromeDragOpacity(chromeDrag.value) }
  })

  const presenceStyle = useAnimatedStyle(() => {
    'worklet'
    const hidden = 1 - presence.value
    const dismissed = edgeDrawerDismissOpacity(
      edgeDrawerVisibleFraction({
        offset: scrollOffset.value,
        range: animatedDismissRange.value,
        height,
        opensFromTop,
      }),
    )
    return {
      opacity: presence.value * dismissed * chromeDragOpacity(chromeDrag.value),
      transform: [
        {
          translateY:
            hidden * (opensFromTop ? -DRAWER_OPEN_TRANSLATE_Y : DRAWER_OPEN_TRANSLATE_Y) +
            chromeDrag.value,
        },
      ],
    }
  })

  return { scrollHandler, backdropStyle, presenceStyle }
}

function chromeDragOpacity(drag: number) {
  'worklet'
  return Math.max(0, 1 - Math.abs(drag) / CHROME_FADE_DISTANCE)
}
/* eslint-enable react-hooks/immutability */
