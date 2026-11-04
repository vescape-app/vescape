import { StyleSheet, View } from 'react-native'
import { useState } from 'react'
import {
  ArrowFatLinesUpIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  CameraIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  DatabaseIcon,
  FadersIcon,
  GearSixIcon,
  HeartIcon,
  RecordIcon,
  SpeakerHighIcon,
  StopIcon,
  TrashIcon,
  UsersThreeIcon,
} from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { IconButton, type IconButtonVariant } from '@/components/base/IconButton'
import {
  IconButtonExtension,
  IconButtonExtensionStat,
} from '@/components/controls/IconButtonExtension'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'

const ICON_BUTTON_VARIANTS: IconButtonVariant[] = ['soft', 'solid', 'outline', 'ghost']

const noop = () => undefined

export function IconButtonShowcase() {
  const [loading, setLoading] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [dot, setDot] = useState(true)
  const [takeover, setTakeover] = useState('backup')
  const [progress, setProgress] = useState('40%')
  const [variant, setVariant] = useState<IconButtonVariant>('soft')

  const activeTakeover =
    takeover === 'none'
      ? null
      : takeover === 'update'
        ? { icon: ArrowFatLinesUpIcon, accent: theme.settingsIcon.update }
        : {
            icon: takeover === 'maintenance' ? DatabaseIcon : ArrowsClockwiseIcon,
            accent:
              takeover === 'maintenance' ? theme.settingsIcon.database : theme.settingsIcon.sync,
            progress: progress === 'none' ? undefined : Number.parseInt(progress, 10) / 100,
          }

  return (
    <ShowcaseCard
      name="IconButton"
      controls={
        <>
          <ChipRow
            label="variant"
            options={ICON_BUTTON_VARIANTS}
            selected={variant}
            onSelect={(v) => setVariant(v as IconButtonVariant)}
          />
          <ToggleRow label="loading" value={loading} onToggle={setLoading} />
          <ToggleRow label="disabled" value={disabled} onToggle={setDisabled} />
          <ToggleRow label="dot" value={dot} onToggle={setDot} />
          <ChipRow
            label="takeover"
            options={['none', 'update', 'backup', 'maintenance']}
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
            variant={variant}
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <IconButton
            icon={GearSixIcon}
            size="lg"
            variant={variant}
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
        </View>
        <View style={{ gap: 8, alignItems: 'center' }}>
          <IconButton
            icon={TrashIcon}
            destructive
            variant={variant}
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <IconButton
            icon={TrashIcon}
            size="lg"
            destructive
            variant={variant}
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
            variant={variant}
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
            variant={variant}
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
            variant={variant}
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
          <IconButton
            icon={UsersThreeIcon}
            size="lg"
            dot={dot ? theme.palette.groupRide.color : undefined}
            accessibilityLabel="Nearby ride"
            variant={variant}
            onPress={() => {}}
            loading={loading}
            disabled={disabled}
          />
        </View>
      </View>
      <View style={styles.accentRow}>
        <IconButton
          icon={CameraIcon}
          accessibilityLabel="Add photo"
          accent={theme.palette.purple.color}
          variant={variant}
          onPress={() => {}}
          loading={loading}
          disabled={disabled}
        />
        <IconButton
          icon={HeartIcon}
          accessibilityLabel="Favorite"
          accent={theme.palette.amber.color}
          variant={variant}
          onPress={() => {}}
          loading={loading}
          disabled={disabled}
        />
        <IconButton
          icon={RecordIcon}
          accessibilityLabel="Record"
          accent={theme.palette.red.color}
          size="md"
          variant={variant}
          onPress={() => {}}
          loading={loading}
          disabled={disabled}
        />
        <IconButton
          icon={StopIcon}
          accessibilityLabel="Stop recording"
          accent={theme.palette.red.color}
          size="lg"
          variant={variant}
          onPress={() => {}}
          loading={loading}
          disabled={disabled}
        />
      </View>
    </ShowcaseCard>
  )
}

export function ButtonShowcase() {
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
            label="Dynamic accent"
            icon={FadersIcon}
            accent={theme.palette.pink.color}
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
          <Button
            style={{ flex: 1 }}
            label="Ride"
            variant="groupRide"
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

const EXTENSION_SIZES = ['sm', 'md', 'lg'] as const

export function IconButtonExtensionShowcase() {
  const [content, setContent] = useState<'none' | 'one stat' | 'two stats' | 'custom'>('two stats')
  const [size, setSize] = useState<(typeof EXTENSION_SIZES)[number]>('lg')
  const [dot, setDot] = useState(false)
  const [disabled, setDisabled] = useState(false)

  const extension = {
    none: null,
    'one stat': <IconButtonExtensionStat value="9.9" unit="km" />,
    'two stats': (
      <>
        <IconButtonExtensionStat value="9.9" unit="km" />
        <IconButtonExtensionStat value="40" unit="min" />
      </>
    ),
    custom: <HeartIcon size={18} color={theme.palette.pink.color} weight="fill" />,
  }[content]

  return (
    <ShowcaseCard
      name="IconButtonExtension"
      controls={
        <>
          <ChipRow
            label="extension"
            options={['none', 'one stat', 'two stats', 'custom']}
            selected={content}
            onSelect={(v) => setContent(v as typeof content)}
          />
          <ChipRow
            label="button size"
            options={[...EXTENSION_SIZES]}
            selected={size}
            onSelect={(v) => setSize(v as typeof size)}
          />
          <ToggleRow label="button dot" value={dot} onToggle={setDot} />
          <ToggleRow label="disabled" value={disabled} onToggle={setDisabled} />
        </>
      }
    >
      <View style={styles.centeredPreview}>
        <IconButtonExtension extension={extension} onPress={noop} disabled={disabled}>
          <IconButton
            icon={ClockCounterClockwiseIcon}
            size={size}
            dot={dot ? theme.status.upgrade.color : undefined}
            disabled={disabled}
            onPress={noop}
          />
        </IconButtonExtension>
      </View>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  accentRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 12 },
  centeredPreview: { alignItems: 'center', paddingVertical: 12 },
})
