import { StyleSheet, View } from 'react-native'
import { useMemo, useState } from 'react'
import { ArrowUpIcon, ArrowsClockwiseIcon, NavigationArrowIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import {
  ExpandableCircleMenu,
  type ExpandableCircleMenuSize,
} from '@/components/controls/ExpandableCircleMenu'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'

export function ExpandableCircleMenuShowcase() {
  const [expandedSize, setExpandedSize] = useState<ExpandableCircleMenuSize | null>(null)
  const [active, setActive] = useState('north')

  return (
    <ShowcaseCard
      name="ExpandableCircleMenu"
      controls={
        <ChipRow
          label="mode"
          options={['north', 'gps', 'free']}
          selected={active}
          onSelect={(v) => {
            setActive(v)
            setExpandedSize(null)
          }}
        />
      }
    >
      {(['sm', 'md'] as const).map((size) => (
        <View key={size} style={styles.variant}>
          <Text style={styles.variantLabel}>{size}</Text>
          <ExpandableCircleMenuPreview
            active={active}
            expanded={expandedSize === size}
            size={size}
            onToggle={() => setExpandedSize(expandedSize === size ? null : size)}
            onSelect={(key) => {
              setActive(key)
              setExpandedSize(null)
            }}
          />
        </View>
      ))}
    </ShowcaseCard>
  )
}

interface ExpandableCircleMenuPreviewProps {
  active: string
  expanded: boolean
  size: ExpandableCircleMenuSize
  onToggle: () => void
  onSelect: (key: string) => void
}

function ExpandableCircleMenuPreview({
  active,
  expanded,
  size,
  onToggle,
  onSelect,
}: ExpandableCircleMenuPreviewProps) {
  const optionIconSize = size === 'sm' ? 17 : 20
  const activeIconSize = size === 'sm' ? 18 : 21
  const options = useMemo(
    () => [
      {
        key: 'north',
        label: 'North',
        icon: (
          <ArrowUpIcon
            size={optionIconSize}
            color={active === 'north' ? theme.palette.green.text : theme.palette.slate.textDim}
            weight="bold"
          />
        ),
      },
      {
        key: 'gps',
        label: 'GPS',
        icon: (
          <NavigationArrowIcon
            size={optionIconSize}
            color={active === 'gps' ? theme.palette.green.text : theme.palette.slate.textDim}
            weight="fill"
          />
        ),
      },
      {
        key: 'free',
        label: 'Free',
        icon: (
          <ArrowsClockwiseIcon
            size={optionIconSize}
            color={active === 'free' ? theme.palette.green.text : theme.palette.slate.textDim}
            weight="bold"
          />
        ),
      },
    ],
    [active, optionIconSize],
  )
  const activeIcon = useMemo(() => {
    if (active === 'north')
      return <ArrowUpIcon size={activeIconSize} color={theme.palette.green.text} weight="bold" />
    if (active === 'gps')
      return (
        <NavigationArrowIcon size={activeIconSize} color={theme.palette.green.text} weight="fill" />
      )
    return (
      <ArrowsClockwiseIcon size={activeIconSize} color={theme.palette.green.text} weight="bold" />
    )
  }, [active, activeIconSize])

  return (
    <ExpandableCircleMenu
      activeKey={active}
      activeIcon={activeIcon}
      activeColor={theme.palette.green.text}
      activeBackground={theme.palette.green.bg}
      collapsedAccessibilityLabel={`${size} navigation mode`}
      expanded={expanded}
      size={size}
      options={options}
      onToggle={onToggle}
      onSelect={onSelect}
    />
  )
}

const styles = StyleSheet.create({
  variant: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  variantLabel: {
    alignSelf: 'stretch',
    color: theme.palette.slate.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
  },
})
