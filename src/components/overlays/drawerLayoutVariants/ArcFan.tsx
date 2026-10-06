/** PROTOTYPE variant — tabs fan out on a quarter-circle arc around a hub on the trigger, view above the fan. */
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Svg, { Line, Path } from 'react-native-svg'

import { Text } from '@/components/base/Text'
import { TabCircle } from '@/components/overlays/drawerLayoutVariants/TabCircle'
import type { DrawerLayoutVariantProps } from '@/components/overlays/drawerLayoutVariants/types'
import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'

const ARC_RADIUS_FACTOR = 2.6
const MIN_TAB_GAP = 10
const CHIP_GAP = 8
const CHIP_RESERVE = 36

/**
 * All positions are computed in a canonical frame: x grows inward from the trigger's side edge, y grows
 * from the drawer-edge end (bottom for a bottom drawer) toward the screen. `place` maps that frame
 * onto real `left`/`right` and `bottom`/`top` offsets, so the fan mirrors for free.
 */
export function ArcFan({
  tabs,
  activeTab,
  onTabChange,
  testID,
  slotSize,
  outset,
  side,
  opensFromTop,
  close,
  children,
}: DrawerLayoutVariantProps) {
  const neutral = useResolvedNeutralColors()
  const tab = tabs.find((candidate) => candidate.id === activeTab) ?? tabs[0]
  const color = useResolvedColor(tab.color)
  const IconComponent = tab.icon
  const [chipSize, setChipSize] = useState({ width: 0, height: 0 })

  const hub = outset + slotSize / 2
  const step = tabs.length > 1 ? Math.PI / 2 / (tabs.length - 1) : 0
  const radius = Math.max(
    slotSize * ARC_RADIUS_FACTOR,
    step > 0 ? (slotSize + MIN_TAB_GAP) / (2 * Math.sin(step / 2)) : 0,
  )
  const fanHeight = hub + radius + slotSize / 2 + CHIP_RESERVE
  const fanWidth = hub + radius + slotSize / 2
  const angleOf = (index: number) => index * step
  const centreOf = (index: number) => ({
    x: hub + radius * Math.sin(angleOf(index)),
    y: hub + radius * Math.cos(angleOf(index)),
  })

  const place = (x: number, y: number, width: number, height: number) => ({
    width,
    height,
    [side]: x - width / 2,
    [opensFromTop ? 'top' : 'bottom']: y - height / 2,
  })

  const activeIndex = Math.max(
    0,
    tabs.findIndex((candidate) => candidate.id === tab.id),
  )
  const active = centreOf(activeIndex)
  const angle = angleOf(activeIndex)
  // The chip sits radially outside the active circle; the fractions keep its near edge on the anchor.
  const chipAnchor = {
    x: active.x + Math.sin(angle) * (slotSize / 2 + CHIP_GAP),
    y: active.y + Math.cos(angle) * (slotSize / 2 + CHIP_GAP),
  }
  const chipCentre = {
    x: chipAnchor.x + (Math.sin(angle) * chipSize.width) / 2,
    y: chipAnchor.y + (Math.cos(angle) * chipSize.height) / 2,
  }

  // Svg is drawn in the canonical frame (y down from the fan's far edge) and flipped to mirror.
  const toSvgY = (y: number) => fanHeight - y
  const arcPath = `M ${hub} ${toSvgY(hub + radius)} A ${radius} ${radius} 0 0 1 ${hub + radius} ${toSvgY(hub)}`

  const fan = (
    <View style={{ height: fanHeight }}>
      <Svg
        width={fanWidth}
        height={fanHeight}
        style={[
          styles.track,
          { [side]: 0, [opensFromTop ? 'top' : 'bottom']: 0 },
          {
            transform: [{ scaleX: side === 'right' ? -1 : 1 }, { scaleY: opensFromTop ? -1 : 1 }],
          },
        ]}
      >
        <Path
          d={arcPath}
          stroke={neutral.border}
          strokeWidth={2}
          strokeDasharray="2 6"
          fill="none"
        />
        <Line
          x1={hub}
          y1={toSvgY(hub)}
          x2={active.x}
          y2={toSvgY(active.y)}
          stroke={theme.alpha(color, 0.4)}
          strokeWidth={3}
          strokeLinecap="round"
        />
      </Svg>

      {tabs.map((candidate, index) => {
        const centre = centreOf(index)
        return (
          <View
            key={candidate.id}
            style={[
              styles.floating,
              place(centre.x, centre.y, slotSize + 2, slotSize + 2),
              {
                borderRadius: slotSize,
                backgroundColor: neutral.surfaceDeep,
                borderColor: neutral.border,
              },
            ]}
          >
            <TabCircle
              tab={candidate}
              size={slotSize}
              active={candidate.id === tab.id}
              testID={testID ? `${testID}-tab-${candidate.id}` : undefined}
              onPress={() => onTabChange(candidate.id)}
            />
          </View>
        )
      })}

      <View
        pointerEvents="none"
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout
          if (width !== chipSize.width || height !== chipSize.height) setChipSize({ width, height })
        }}
        style={[
          styles.chip,
          {
            [side]: chipCentre.x - chipSize.width / 2,
            [opensFromTop ? 'top' : 'bottom']: chipCentre.y - chipSize.height / 2,
            opacity: chipSize.width > 0 ? 1 : 0,
            backgroundColor: theme.alpha(color, 0.12),
            borderColor: theme.alpha(color, 0.6),
          },
        ]}
      >
        <Text style={[styles.chipText, { color }]}>{tab.label}</Text>
      </View>

      <Pressable
        style={[
          styles.hub,
          place(hub, hub, slotSize, slotSize),
          { borderRadius: slotSize / 2, backgroundColor: color },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={close}
      >
        <IconComponent
          size={Math.round(slotSize * 0.46)}
          color={theme.palette.mono.white}
          weight="fill"
        />
      </Pressable>
    </View>
  )

  const view = (
    <View style={styles.view}>
      <Pressable style={styles.header} onPress={close} accessibilityRole="button">
        <IconComponent size={22} color={color} weight="duotone" />
        <Text style={[styles.title, { color: neutral.textPrimary }]}>{tab.label}</Text>
      </Pressable>
      {children}
    </View>
  )

  return (
    <View style={styles.column}>
      {opensFromTop ? fan : view}
      {opensFromTop ? view : fan}
    </View>
  )
}

const styles = StyleSheet.create({
  column: {
    gap: 12,
  },
  track: {
    position: 'absolute',
  },
  floating: {
    position: 'absolute',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chip: {
    position: 'absolute',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  hub: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  view: {
    gap: 12,
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
