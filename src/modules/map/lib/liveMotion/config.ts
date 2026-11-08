import { getMapDisplayControls } from 'vescape-core'
export type { MotionConfig } from 'vescape-core'

/** Metadata is supplied by native; no JS copy of defaults or validation ranges. */
export const motionControls = getMapDisplayControls()
