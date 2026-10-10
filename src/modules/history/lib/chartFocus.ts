import { makeMutable } from 'react-native-reanimated'

import type { ChartTimeRange } from '@/components/charts/line/types'

/**
 * The moment under the finger on the history chart, or `null` when nobody is scrubbing.
 *
 * A module singleton rather than state, because exactly one ride is scrubbable at a time and
 * because everything that follows the finger — the chart's own readings, the marker on the map —
 * has to be driven from the UI thread. Routing it through React was what made scrubbing lag: a
 * store write per touch sample re-rendered the panel and re-snapshotted a native map annotation.
 */
export const scrubHeadMs = makeMutable<number | null>(null)

/**
 * The stretch of ride the chart is zoomed into, or `null` when it shows the whole thing.
 *
 * Same reasoning as {@link scrubHeadMs}: a pinch moves this every frame, so it is written and
 * read on the UI thread and only the consumers that must render sample it.
 */
export const zoomWindowMs = makeMutable<ChartTimeRange | null>(null)
