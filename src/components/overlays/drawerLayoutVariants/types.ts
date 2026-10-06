/** PROTOTYPE — shared contract for the tabbed-drawer layout variants. Wipe with the prototype. */
import type { EdgeDrawerAnchorGeometry } from '@/components/overlays/EdgeDrawer'
import type { DrawerTab } from '@/components/overlays/TabbedEdgeDrawer'

/**
 * Everything a layout variant gets. It renders the WHOLE drawer body (tabs, header, view) inside the
 * drawer's scroll body. The body box already sits `outset` past the trigger on the trigger's side
 * and its far end (bottom for a bottom drawer, top for a top drawer) is level with the trigger's
 * outer edge + outset. So a `slotSize` circle placed `outset` in from the trigger-side edge and the
 * drawer-edge end sits exactly over the trigger button.
 */
export interface DrawerLayoutVariantProps extends EdgeDrawerAnchorGeometry {
  tabs: readonly DrawerTab<string>[]
  activeTab: string
  onTabChange: (id: string) => void
  /** Tab buttons must use testID `${testID}-tab-${id}` when set. */
  testID?: string
  /** Outset between trigger and the body's trigger-side edge. */
  outset: number
  /** The open tab's view. Render it once. */
  children: React.ReactNode
}
