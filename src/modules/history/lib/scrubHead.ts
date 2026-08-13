import { makeMutable } from 'react-native-reanimated'

/**
 * The moment under the finger on the history chart, or `null` when nobody is scrubbing.
 *
 * A module singleton rather than state, because exactly one ride is scrubbable at a time and
 * because everything that follows the finger — the chart's own readings, the marker on the map —
 * has to be driven from the UI thread. Routing it through React was what made scrubbing lag: a
 * store write per touch sample re-rendered the panel and re-snapshotted a native map annotation.
 */
export const scrubHeadMs = makeMutable<number | null>(null)
