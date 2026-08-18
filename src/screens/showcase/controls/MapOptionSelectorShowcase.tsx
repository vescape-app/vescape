import { View } from 'react-native'
import { useMemo, useState } from 'react'
import { ArrowUpIcon, ArrowsClockwiseIcon, NavigationArrowIcon } from 'phosphor-react-native'

import { MapOptionSelector } from '@/components/controls/MapOptionSelector'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'

export function MapOptionSelectorShowcase() {
  const [expanded, setExpanded] = useState(false)
  const [active, setActive] = useState('north')

  const options = useMemo(
    () => [
      {
        key: 'north',
        label: 'North',
        icon: (
          <ArrowUpIcon
            size={20}
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
            size={20}
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
            size={20}
            color={active === 'free' ? theme.palette.green.text : theme.palette.slate.textDim}
            weight="bold"
          />
        ),
      },
    ],
    [active],
  )

  const activeIcon = useMemo(() => {
    if (active === 'north')
      return <ArrowUpIcon size={21} color={theme.palette.green.text} weight="bold" />
    if (active === 'gps')
      return <NavigationArrowIcon size={21} color={theme.palette.green.text} weight="fill" />
    return <ArrowsClockwiseIcon size={21} color={theme.palette.green.text} weight="bold" />
  }, [active])

  return (
    <ShowcaseCard
      name="MapOptionSelector"
      controls={
        <ChipRow
          label="mode"
          options={['north', 'gps', 'free']}
          selected={active}
          onSelect={(v) => {
            setActive(v)
            setExpanded(false)
          }}
        />
      }
    >
      <View style={{ alignItems: 'center', paddingVertical: 12 }}>
        <MapOptionSelector
          activeKey={active}
          activeIcon={activeIcon}
          activeColor={theme.palette.green.text}
          activeBackground={theme.palette.green.bg}
          collapsedAccessibilityLabel="Navigation mode"
          expanded={expanded}
          options={options}
          onToggle={() => setExpanded((p) => !p)}
          onSelect={(k) => {
            setActive(k)
            setExpanded(false)
          }}
        />
      </View>
    </ShowcaseCard>
  )
}
