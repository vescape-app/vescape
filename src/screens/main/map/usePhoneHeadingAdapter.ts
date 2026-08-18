import { useMemo } from 'react'
import { isReplayBoardId } from 'vescape-core'

import { useBleStore } from '@/modules/board/store/bleStore'
import { deviceMotionPhoneHeadingAdapter } from '@/modules/map/lib/deviceMotionPhoneHeadingAdapter'
import { createReplayPhoneHeadingAdapter } from '@/modules/map/lib/replayPhoneHeadingAdapter'
import type { PhoneHeadingAdapter } from '@/modules/map/lib/phoneHeading'

/**
 * Where the map's compass readings come from: the phone's magnetometer normally, and the recorded
 * stream while a Debug Recording is being replayed.
 *
 * Lives in the composition layer because picking between them is the one place map and board have to
 * cooperate — the map module owns both adapters but has no business knowing what a board session is.
 * Keeping the choice here also keeps it out of the map component itself, which just asks for a
 * compass; everything past this point is the same code either way.
 */
export function usePhoneHeadingAdapter(): PhoneHeadingAdapter {
  const isReplay = useBleStore((s) => isReplayBoardId(s.connectedId))
  return useMemo(
    () => (isReplay ? createReplayPhoneHeadingAdapter() : deviceMotionPhoneHeadingAdapter),
    [isReplay],
  )
}
