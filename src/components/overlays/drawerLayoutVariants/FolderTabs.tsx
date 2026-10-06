/** PROTOTYPE variant — binder tabs on the trigger side; the active tab merges into one big sheet panel. */
import { Pressable, StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

import { Text } from '@/components/base/Text'
import type { DrawerLayoutVariantProps } from '@/components/overlays/drawerLayoutVariants/types'
import type { DrawerTab } from '@/components/overlays/TabbedEdgeDrawer'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'

const SLOT_GAP = 6
const FILLET = 8
const PANEL_RADIUS = 26
/** Inactive tabs sit this much smaller on every free side, recessed behind the panel. */
const RECESS = 4

export function FolderTabs({
  tabs,
  activeTab,
  onTabChange,
  testID,
  slotSize,
  railWidth,
  outset,
  side,
  opensFromTop,
  close,
  children,
}: DrawerLayoutVariantProps) {
  const neutral = useResolvedNeutralColors()
  const tab = tabs.find((candidate) => candidate.id === activeTab) ?? tabs[0]
  const IconComponent = tab.icon
  const farPadding = FILLET + 6
  const columnHeight = outset + farPadding + tabs.length * slotSize + (tabs.length - 1) * SLOT_GAP
  const triggerIndex = opensFromTop ? 0 : tabs.length - 1
  const isLeft = side === 'left'
  const tabCorner = opensFromTop
    ? isLeft
      ? 'borderTopLeftRadius'
      : 'borderTopRightRadius'
    : isLeft
      ? 'borderBottomLeftRadius'
      : 'borderBottomRightRadius'

  return (
    <View
      style={[
        {
          flexDirection: isLeft ? 'row' : 'row-reverse',
          alignItems: opensFromTop ? 'flex-start' : 'flex-end',
        },
      ]}
    >
      <View
        style={[
          styles.column,
          {
            width: railWidth,
            height: columnHeight,
            paddingTop: opensFromTop ? outset : farPadding,
            paddingBottom: opensFromTop ? farPadding : outset,
          },
        ]}
      >
        {tabs.map((candidate, index) => (
          <FolderTab
            key={candidate.id}
            tab={candidate}
            active={candidate.id === tab.id}
            slotSize={slotSize}
            width={railWidth}
            outset={outset}
            isLeft={isLeft}
            filletBefore={index === triggerIndex && opensFromTop ? outset : FILLET}
            filletAfter={index === triggerIndex && !opensFromTop ? outset : FILLET}
            testID={testID ? `${testID}-tab-${candidate.id}` : undefined}
            onPress={() => onTabChange(candidate.id)}
          />
        ))}
      </View>
      <View
        style={[
          styles.panel,
          {
            minHeight: columnHeight,
            backgroundColor: neutral.surface,
            borderColor: neutral.border,
            [tabCorner]: 0,
          },
        ]}
      >
        <Pressable style={styles.header} onPress={close} accessibilityRole="button">
          <IconComponent size={22} color={tab.color} weight="duotone" />
          <Text style={[styles.title, { color: neutral.textPrimary }]}>{tab.label}</Text>
        </Pressable>
        {children}
      </View>
    </View>
  )
}

function FolderTab({
  tab,
  active,
  slotSize,
  width,
  outset,
  isLeft,
  filletBefore,
  filletAfter,
  testID,
  onPress,
}: {
  tab: DrawerTab<string>
  active: boolean
  slotSize: number
  width: number
  outset: number
  isLeft: boolean
  /** Concave join radius above / below the active tab where it meets the panel edge. */
  filletBefore: number
  filletAfter: number
  testID?: string
  onPress: () => void
}) {
  const neutral = useResolvedNeutralColors()
  const color = useResolvedColor(tab.color)
  const IconComponent = tab.icon
  const stubHeight = slotSize - RECESS * 2

  return (
    <Pressable
      style={{ width, height: slotSize }}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
      testID={testID}
      onPress={onPress}
    >
      {({ pressed }) => (
        <>
          {active ? (
            <View
              pointerEvents="none"
              style={[
                styles.join,
                {
                  top: -filletBefore,
                  width: width + 2,
                  height: slotSize + filletBefore + filletAfter,
                  transform: isLeft ? undefined : [{ scaleX: -1 }],
                },
                isLeft ? { left: 0 } : { right: 0 },
              ]}
            >
              <Svg width={width + 2} height={slotSize + filletBefore + filletAfter}>
                <Path
                  d={tabPath(width, slotSize, outset, filletBefore, filletAfter, true)}
                  fill={neutral.surface}
                />
                <Path
                  d={tabPath(width, slotSize, outset, filletBefore, filletAfter, false)}
                  fill="none"
                  stroke={neutral.border}
                  strokeWidth={1}
                />
              </Svg>
            </View>
          ) : (
            <View
              pointerEvents="none"
              style={[
                styles.stub,
                {
                  top: RECESS,
                  height: stubHeight,
                  width: width - outset - RECESS,
                  backgroundColor: pressed ? neutral.surface : neutral.surfaceDeep,
                  borderColor: neutral.border,
                },
                isLeft
                  ? {
                      left: outset + RECESS,
                      borderRightWidth: 0,
                      borderTopLeftRadius: stubHeight / 2,
                      borderBottomLeftRadius: stubHeight / 2,
                    }
                  : {
                      right: outset + RECESS,
                      borderLeftWidth: 0,
                      borderTopRightRadius: stubHeight / 2,
                      borderBottomRightRadius: stubHeight / 2,
                    },
              ]}
            />
          )}
          <View
            pointerEvents="none"
            style={[
              styles.icon,
              { width: slotSize, height: slotSize },
              isLeft ? { left: outset } : { right: outset },
            ]}
          >
            <IconComponent
              size={Math.round(slotSize * (active ? 0.42 : 0.36))}
              color={active ? color : neutral.textMuted}
              weight={active ? 'duotone' : 'regular'}
            />
          </View>
        </>
      )}
    </Pressable>
  )
}

/**
 * Active tab outline drawn for a left-side column (mirrored for the right): a half-round cap over
 * the trigger slot running into the panel edge at x = width, with concave fillets into the edge.
 * The fill reaches past the edge to cover the panel's own border so the two read as one sheet.
 */
function tabPath(
  width: number,
  slotSize: number,
  outset: number,
  before: number,
  after: number,
  fill: boolean,
) {
  const radius = slotSize / 2
  const capX = outset + radius
  const top = before
  const bottom = before + slotSize
  const edge = width + 0.5
  const outline = [
    `M ${edge} 0`,
    `A ${before} ${before} 0 0 1 ${edge - before} ${top}`,
    `L ${capX} ${top}`,
    `A ${radius} ${radius} 0 0 0 ${capX} ${bottom}`,
    `L ${edge - after} ${bottom}`,
    `A ${after} ${after} 0 0 1 ${edge} ${bottom + after}`,
  ].join(' ')
  return fill ? `${outline} L ${width + 2} ${bottom + after} L ${width + 2} 0 Z` : outline
}

const styles = StyleSheet.create({
  column: {
    zIndex: 2,
    gap: SLOT_GAP,
  },
  join: {
    position: 'absolute',
  },
  stub: {
    position: 'absolute',
    borderWidth: 1,
  },
  icon: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    flex: 1,
    minWidth: 0,
    zIndex: 1,
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderRadius: PANEL_RADIUS,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    minHeight: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
})
