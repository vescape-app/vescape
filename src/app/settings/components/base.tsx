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

function IconButtonShowcase() {
  const [loading, setLoading] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [dot, setDot] = useState(true)
  const [takeover, setTakeover] = useState('backup')
  const [progress, setProgress] = useState('40%')

  const activeTakeover =
    takeover === 'none'
      ? null
      : takeover === 'update'
        ? { icon: ArrowFatLinesUpIcon, accent: theme.settingsIcon.update }
        : {
            icon: ArrowsClockwiseIcon,
            accent: theme.settingsIcon.sync,
            progress: progress === 'none' ? undefined : Number.parseInt(progress, 10) / 100,
          }

  return (
    <ShowcaseCard
      name="IconButton"
      controls={
        <>
          <ToggleRow label="loading" value={loading} onToggle={setLoading} />
          <ToggleRow label="disabled" value={disabled} onToggle={setDisabled} />
          <ToggleRow label="dot" value={dot} onToggle={setDot} />
          <ChipRow
            label="takeover"
            options={['none', 'update', 'backup']}
            selected={takeover}
            onSelect={setTakeover}
          />
          <ChipRow
            label="progress"
            options={['none', '10%', '40%', '85%']}
            selected={progress}
            onSelect={setProgress}
          />
        </>
      }
    >
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={{ gap: 8, alignItems: 'center' }}>
          <IconButton
            icon={ArrowLeftIcon}
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <IconButton
            icon={GearSixIcon}
            size="lg"
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
        </View>
        <View style={{ gap: 8, alignItems: 'center' }}>
          <IconButton
            icon={TrashIcon}
            destructive
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <IconButton
            icon={TrashIcon}
            size="lg"
            destructive
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
        </View>
        <View style={{ gap: 8, alignItems: 'center' }}>
          <IconButton
            icon={GearSixIcon}
            takeover={activeTakeover}
            dot={dot ? theme.status.upgrade.color : undefined}
            accessibilityLabel="Settings"
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <IconButton
            icon={GearSixIcon}
            size="lg"
            takeover={activeTakeover}
            dot={dot ? theme.status.upgrade.color : undefined}
            accessibilityLabel="Settings"
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
        </View>
        <View style={{ gap: 8, alignItems: 'center' }}>
          <IconButton
            icon={UsersThreeIcon}
            dot={dot ? theme.palette.groupRide.color : undefined}
            accessibilityLabel="Nearby ride"
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <IconButton
            icon={UsersThreeIcon}
            size="lg"
            dot={dot ? theme.palette.groupRide.color : undefined}
            accessibilityLabel="Nearby ride"
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
        </View>
      </View>
    </ShowcaseCard>
  )
}

function ButtonShowcase() {
  const [loading, setLoading] = useState(false)
  const [disabled, setDisabled] = useState(false)

  return (
    <ShowcaseCard
      name="Button"
      controls={
        <>
          <ToggleRow label="loading" value={loading} onToggle={setLoading} />
          <ToggleRow label="disabled" value={disabled} onToggle={setDisabled} />
        </>
      }
    >
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button
            label="Primary"
            variant="primary"
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <Button
            label="Secondary"
            variant="secondary"
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <Button
            label="Tune"
            variant="tune"
            icon={FadersIcon}
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <Button
            label="Enabled"
            variant="success"
            icon={CheckIcon}
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <Button
            label="Preview"
            variant="caution"
            icon={SpeakerHighIcon}
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <Button
            label="Delete"
            variant="destructive"
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            style={{ flex: 1 }}
            label="With icon"
            variant="primary"
            icon={TrashIcon}
            size="sm"
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <Button
            style={{ flex: 1 }}
            label="Skip"
            variant="accent"
            icon={ArrowRightIcon}
            iconPosition="right"
            size="sm"
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
        </View>
      </View>
    </ShowcaseCard>
  )
}

function PlaceholderShowcase() {
  const [showTitle, setShowTitle] = useState(true)
  const [showAction, setShowAction] = useState(true)
  const [color, setColor] = useState<string>(theme.palette.slate.textMuted)

  return (
    <ShowcaseCard
      name="Placeholder"
      controls={
        <>
          <ToggleRow label="showTitle" value={showTitle} onToggle={setShowTitle} />
          <ToggleRow label="showAction" value={showAction} onToggle={setShowAction} />
          <ChipRow
            label="iconColor"
            options={[
              theme.palette.slate.textMuted,
              theme.palette.sky.color,
              theme.status.error.color,
            ]}
            selected={color}
            onSelect={setColor}
          />
        </>
      }
    >
      <View style={{ height: 220 }}>
        <Placeholder
          icon={GhostIcon}
          title={showTitle ? 'No data yet' : undefined}
          description="Connect board to start streaming telemetry"
          iconColor={color}
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
          color={theme.palette.slate.textMuted}
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
    </ShowcaseCard>
  )
}

export default function BaseComponentsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={CubeIcon}
          description="Button, IconButton, SectionHeader, Banner, Placeholder, TickText."
        />
        <IconButtonShowcase />
        <ButtonShowcase />
        <SectionHeaderShowcase />
        <PlaceholderShowcase />
        <BannerShowcase />
        <TickTextShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  tickBox: {
    gap: 6,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    borderRadius: 6,
    padding: 8,
  },
  tickValue: { alignSelf: 'stretch' },
})
