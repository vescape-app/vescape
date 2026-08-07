import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CubeIcon,
  FadersIcon,
  GearSixIcon,
  GhostIcon,
  TrashIcon,
  UsersThreeIcon,
} from 'phosphor-react-native'

import { Banner } from '@/components/base/Banner'
import { IconHero } from '@/components/settings/IconHero'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Placeholder } from '@/components/base/Placeholder'
import { ScreenTitle } from '@/components/base/ScreenTitle'
import { VescapeWordmark } from '@/components/base/VescapeWordmark'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

function IconButtonShowcase() {
  const [loading, setLoading] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [dot, setDot] = useState(true)

  return (
    <ShowcaseCard
      name="IconButton"
      controls={
        <>
          <ToggleRow label="loading" value={loading} onToggle={setLoading} />
          <ToggleRow label="disabled" value={disabled} onToggle={setDisabled} />
          <ToggleRow label="dot" value={dot} onToggle={setDot} />
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
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            style={{ flex: 1 }}
            label="Primary"
            variant="primary"
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <Button
            style={{ flex: 1 }}
            label="Secondary"
            variant="secondary"
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <Button
            style={{ flex: 1 }}
            label="Tune"
            variant="tune"
            icon={FadersIcon}
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <Button
            style={{ flex: 1 }}
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
  const neutral = useResolvedNeutralColors()
  const [showTitle, setShowTitle] = useState(true)
  const [showAction, setShowAction] = useState(true)
  const [color, setColor] = useState<string>(neutral.textMuted)

  return (
    <ShowcaseCard
      name="Placeholder"
      controls={
        <>
          <ToggleRow label="showTitle" value={showTitle} onToggle={setShowTitle} />
          <ToggleRow label="showAction" value={showAction} onToggle={setShowAction} />
          <ChipRow
            label="iconColor"
            options={[neutral.textMuted, theme.palette.sky.color, theme.status.error.color]}
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

function ScreenTitleShowcase() {
  return (
    <ShowcaseCard name="ScreenTitle">
      <ScreenTitle title="Dashboard" />
    </ShowcaseCard>
  )
}

function VescapeWordmarkShowcase() {
  return (
    <ShowcaseCard name="VescapeWordmark">
      <View style={{ alignItems: 'center' }}>
        <VescapeWordmark width={220} />
      </View>
    </ShowcaseCard>
  )
}

export default function BaseComponentsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={CubeIcon}
          description="Button, IconButton, Banner, Placeholder, ScreenTitle, VescapeWordmark."
        />
        <VescapeWordmarkShowcase />
        <IconButtonShowcase />
        <ButtonShowcase />
        <PlaceholderShowcase />
        <BannerShowcase />
        <ScreenTitleShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
