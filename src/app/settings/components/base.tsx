import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useEffect, useState } from 'react'
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import {
  ArrowFatLinesUpIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  CheckIcon,
  CubeIcon,
  DatabaseIcon,
  FadersIcon,
  GearSixIcon,
  BellRingingIcon,
  GhostIcon,
  ScalesIcon,
  SpeakerHighIcon,
  TrashIcon,
  UsersThreeIcon,
} from 'phosphor-react-native'

import { Banner } from '@/components/base/Banner'
import { TickText } from '@/components/base/TickText'
import type { MonoValueAlign } from '@/components/base/MonoValue'
import { IconHero } from '@/components/settings/IconHero'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { SectionHeader } from '@/components/base/SectionHeader'
import { Placeholder } from '@/components/base/Placeholder'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { theme, type MonoWeight } from '@/constants/theme'

function PlaceholderShowcase() {
  const [showTitle, setShowTitle] = useState(true)
  const [showAction, setShowAction] = useState(true)
  const [compact, setCompact] = useState(false)
  const [colorKey, setColorKey] = useState<'muted' | 'sky' | 'error'>('muted')
  const color = {
    muted: theme.neutral.textMuted,
    sky: theme.palette.sky.color,
    error: theme.status.error.color,
  }[colorKey]

  return (
    <ShowcaseCard
      name="Placeholder"
      controls={
        <>
          <ToggleRow label="showTitle" value={showTitle} onToggle={setShowTitle} />
          <ToggleRow label="showAction" value={showAction} onToggle={setShowAction} />
          <ToggleRow label="compact" value={compact} onToggle={setCompact} />
          <ChipRow
            label="iconColor"
            options={['muted', 'sky', 'error']}
            selected={colorKey}
            onSelect={(value) => setColorKey(value as typeof colorKey)}
          />
        </>
      }
    >
      <View style={{ height: 220 }}>
        <Placeholder
          iconColor={color}
          icon={GhostIcon}
          compact={compact}
          title={showTitle ? 'No data yet' : undefined}
          description="Connect board to start streaming telemetry"
          action={
            showAction ? (
              <Button label="Get started" size="lg" icon={ArrowRightIcon} onPress={() => {}} />
            ) : null
          }
        />
      </View>
    </ShowcaseCard>
  )
}

function BannerShowcase() {
  const [variant, setVariant] = useState<'info' | 'warning' | 'error'>('warning')
  const [showTitle, setShowTitle] = useState(true)

  return (
    <ShowcaseCard
      name="Banner"
      controls={
        <>
          <ChipRow
            label="variant"
            options={['info', 'warning', 'error']}
            selected={variant}
            onSelect={(v) => setVariant(v as typeof variant)}
          />
          <ToggleRow label="title" value={showTitle} onToggle={setShowTitle} />
        </>
      }
    >
      <Banner
        variant={variant}
        title={showTitle ? 'Work in progress' : undefined}
        message="Tune editing is experimental. Do not sync changes to the board until this feature is stable."
      />
    </ShowcaseCard>
  )
}

function TickTextShowcase() {
  const [weight, setWeight] = useState<MonoWeight>('700')
  const [align, setAlign] = useState<MonoValueAlign>('right')
  const [empty, setEmpty] = useState(false)
  const value = useSharedValue<number | null>(0)

  useEffect(() => {
    if (empty) {
      cancelAnimation(value)
      value.value = null
      return
    }
    value.value = withRepeat(withTiming(42.7, { duration: 3000, easing: Easing.linear }), -1, true)
    return () => cancelAnimation(value)
  }, [empty, value])

  return (
    <ShowcaseCard
      name="TickText / MonoValue"
      controls={
        <>
          <ChipRow
            label="weight"
            options={['500', '600', '700', '800']}
            selected={weight}
            onSelect={(v) => setWeight(v as MonoWeight)}
          />
          <ChipRow
            label="align"
            options={['left', 'center', 'right']}
            selected={align}
            onSelect={(v) => setAlign(v as MonoValueAlign)}
          />
          <ToggleRow label="no value (unit placeholder)" value={empty} onToggle={setEmpty} />
        </>
      }
    >
      <View style={styles.tickBox}>
        <TickText
          value={value}
          decimals={1}
          unit=" km/h"
          size={28}
          weight={weight}
          align={align}
          color={theme.telemetry.speed}
          style={styles.tickValue}
        />
        <TickText
          value={value}
          decimals={0}
          unit="%"
          size={12}
          weight={weight}
          align={align}
          color={theme.neutral.textMuted}
          style={styles.tickValue}
        />
      </View>
    </ShowcaseCard>
  )
}

function SectionHeaderShowcase() {
  return (
    <ShowcaseCard name="SectionHeader">
      <SectionHeader icon={BellRingingIcon} color={theme.palette.yellow.color} title="Alerts" />
      <SectionHeader
        icon={ScalesIcon}
        title="Cell balance"
        description="20S pack"
        right={<Button label="Preview" variant="caution" size="sm" onPress={() => {}} />}
      />
      <SectionHeader
        icon={BellRingingIcon}
        title="Centred"
        description="Centred variant"
        align="center"
      />
    </ShowcaseCard>
  )
}

export default function BaseComponentsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero icon={CubeIcon} description="SectionHeader, Banner, Placeholder, TickText." />
        <SectionHeaderShowcase />
        <PlaceholderShowcase />
        <BannerShowcase />
        <TickTextShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  tickBox: {
    gap: 6,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 6,
    padding: 8,
  },
  tickValue: { alignSelf: 'stretch' },
})
