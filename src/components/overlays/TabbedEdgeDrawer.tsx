import { View } from 'react-native'
import type { Icon } from 'phosphor-react-native'

import { EdgeDrawer, type EdgeDrawerProps } from '@/components/overlays/EdgeDrawer'
import { useDrawerLayoutVariant } from '@/components/overlays/drawerLayout.prototype'
import type { ThemeColor } from '@/constants/theme'

/** How far the tab chrome reaches past the trigger it grows out of. */
const PILL_OUTSET = 5

export interface DrawerTab<Id extends string> {
  id: Id
  label: string
  icon: Icon
  color: ThemeColor
}

interface TabbedEdgeDrawerProps<Id extends string> extends Omit<
  EdgeDrawerProps,
  'title' | 'icon' | 'iconColor' | 'virtualizedContent' | 'rail'
> {
  tabs: readonly DrawerTab<Id>[]
  activeTab: Id
  onTabChange: (id: Id) => void
  /** Rail edge; the side of the screen the trigger sits on. */
  side: 'left' | 'right'
  /** Content root test id; each tab button gets `<testID>-tab-<id>`. */
  testID?: string
  /** The open tab's view. */
  children: React.ReactNode
}

/**
 * An edge drawer that shows one full view at a time. Its tabs grow out of the round trigger as a
 * pill in a fixed order, the open one marked by a circle the trigger's size, and the view lines up
 * beside them. Tabs never move, so each stays where the thumb learned it. The header names the
 * open tab.
 */
export function TabbedEdgeDrawer<Id extends string>({
  tabs,
  activeTab,
  onTabChange,
  side,
  testID,
  children,
  ...drawer
}: TabbedEdgeDrawerProps<Id>) {
  const { Component: Layout } = useDrawerLayoutVariant()
  const tab = tabs.find((candidate) => candidate.id === activeTab) ?? tabs[0]

  return (
    <EdgeDrawer
      {...drawer}
      title={tab.label}
      icon={tab.icon}
      iconColor={tab.color}
      rail={{
        side,
        outset: PILL_OUTSET,
        render: (geometry) => (
          <Layout
            {...geometry}
            outset={PILL_OUTSET}
            tabs={tabs}
            activeTab={tab.id}
            onTabChange={(id) => onTabChange(id as Id)}
            testID={testID}
          >
            <View testID={testID}>{children}</View>
          </Layout>
        ),
      }}
    />
  )
}
