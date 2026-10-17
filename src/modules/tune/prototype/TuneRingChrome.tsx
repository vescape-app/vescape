import { createElement, useRef, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import {
  PlusIcon,
  ClockCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowCounterClockwiseIcon,
  CheckIcon,
} from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { HeaderBackButton } from '@/components/base/HeaderBackButton'
import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { TuneProfilePill } from '@/modules/tune/components/TuneProfilePill'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'
import {
  TuneProfileMetadataModal,
  tuneProfileColorTheme,
  tuneProfileIconComponent,
} from '@/modules/tune/components/TuneProfileMetadataModal'
import type { usePrototypeProfiles } from './usePrototypeProfiles'

type ProfileLab = ReturnType<typeof usePrototypeProfiles>
export function TuneRingTopBar({
  enabled,
  children,
  history,
}: {
  enabled: boolean
  children: ReactNode
  history: ProfileLab['history']
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<View>(null)
  const neutral = useResolvedNeutralColors()
  if (!enabled) return children
  return (
    <>
      <View style={styles.header}>
        <HeaderBackButton />
        <View style={styles.center}>{children}</View>
        <View ref={ref} collapsable={false}>
          <IconButton
            icon={ClockCounterClockwiseIcon}
            accessibilityLabel="Tune changelog"
            onPress={() => setOpen(true)}
          />
        </View>
      </View>
      <EdgeDrawer
        visible={open}
        triggerRef={ref}
        onClose={() => setOpen(false)}
        title="Tune changelog"
        icon={ClockCounterClockwiseIcon}
      >
        <View style={styles.history}>
          <Text style={{ color: neutral.textMuted, fontSize: 12 }}>
            Changes in this prototype session.
          </Text>
          {history.length === 0 ? (
            <Text style={{ color: neutral.textSecondary }}>No changes yet.</Text>
          ) : (
            history.map((entry, index) => (
              <View key={index} style={styles.historyEntry}>
                <Text style={{ color: neutral.textMuted, fontSize: 11 }}>{entry.time}</Text>
                {entry.changes.map((change) => (
                  <Text key={change} style={{ color: neutral.textPrimary, fontSize: 13 }}>
                    {change}
                  </Text>
                ))}
              </View>
            ))
          )}
        </View>
      </EdgeDrawer>
    </>
  )
}
export function TuneRingProfileFooter({
  lab,
  paddingBottom,
}: {
  lab: ProfileLab
  paddingBottom: number
}) {
  const [creating, setCreating] = useState(false)
  const tint = tuneProfileColorTheme(lab.activeProfile.color)
  const backgroundColor = useResolvedColor(tint.bg)
  const borderColor = useResolvedColor(tint.border)
  const color = useResolvedColor(tint.color)
  if (lab.dirty)
    return (
      <View style={[styles.footer, { paddingBottom }]}>
        <View style={[styles.editFooter, { backgroundColor, borderColor }]}>
          {createElement(tuneProfileIconComponent(lab.activeProfile.icon), {
            size: 20,
            color,
            weight: 'duotone',
          })}
          <View style={{ flexShrink: 1, marginRight: 12, gap: 2 }}>
            <Text numberOfLines={1} style={{ color, fontWeight: '700' }}>
              {lab.activeProfile.name}
            </Text>
            <Text numberOfLines={1} style={{ color, fontSize: 10, opacity: 0.75 }}>
              {lab.changedCount} {lab.changedCount === 1 ? 'field changed' : 'fields changed'}
            </Text>
          </View>
          <Button
            label="Discard"
            size="sm"
            variant="destructive"
            icon={ArrowCounterClockwiseIcon}
            onPress={lab.discard}
          />
          <Button label="Save" size="sm" accent={tint.color} icon={CheckIcon} onPress={lab.save} />
        </View>
      </View>
    )
  return (
    <View style={[styles.footer, { paddingBottom }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.largeProfiles}
      >
        {lab.profiles.map((profile) => (
          <TuneProfilePill
            key={profile.id}
            label={profile.name}
            icon={tuneProfileIconComponent(profile.icon)}
            color={tuneProfileColorTheme(profile.color)}
            active={profile.id === lab.activeId}
            onPress={() => lab.select(profile.id)}
          />
        ))}
        <IconButton
          size="md"
          icon={PlusIcon}
          accessibilityLabel="Add tune"
          onPress={() => setCreating(true)}
        />
      </ScrollView>
      <TuneProfileMetadataModal
        visible={creating}
        title="New prototype tune"
        confirmLabel="Create"
        initialValue={{ name: 'My tune' }}
        onConfirm={(metadata) => {
          lab.create(metadata)
          setCreating(false)
        }}
        onDismiss={() => setCreating(false)}
      />
    </View>
  )
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  center: { flex: 1, alignItems: 'center' },
  largeProfiles: { gap: 8, alignItems: 'center', paddingHorizontal: 2 },
  editFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'center',
    maxWidth: '100%',
    borderRadius: 999,
    borderWidth: 1,
    padding: 8,
  },
  footer: { paddingTop: 10, paddingHorizontal: 16, alignItems: 'center' },
  history: { gap: 16, paddingVertical: 12 },
  historyEntry: { gap: 6 },
})

export function TuneRingVariantSwitcher({
  variant,
  label,
  onVariant,
}: {
  variant: number
  label: string
  onVariant: (variant: number) => void
}) {
  const neutral = useResolvedNeutralColors()
  return (
    <View
      style={{
        alignSelf: 'center',
        borderRadius: 24,
        borderWidth: 1,
        paddingHorizontal: 3,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: neutral.surface,
        borderColor: neutral.border,
      }}
    >
      <IconButton
        size="sm"
        icon={ArrowLeftIcon}
        accessibilityLabel="Previous variant"
        onPress={() => onVariant(variant === 1 ? 6 : variant - 1)}
      />
      <Text
        style={{ fontSize: 11, fontWeight: '700', textAlign: 'center', color: neutral.textPrimary }}
      >
        {variant} / 6 · {label}
      </Text>
      <IconButton
        size="sm"
        icon={ArrowRightIcon}
        accessibilityLabel="Next variant"
        onPress={() => onVariant(variant === 6 ? 1 : variant + 1)}
      />
    </View>
  )
}

export function TuneRingNavigation({
  page,
  onPage,
  paddingBottom,
}: {
  page: number
  onPage: (page: number) => void
  paddingBottom: number
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom,
      }}
    >
      <Button
        label="Back"
        variant="secondary"
        icon={ArrowLeftIcon}
        style={{ flex: 1 }}
        disabled={page === 0}
        onPress={() => onPage(page - 1)}
      />
      <Button
        label="Next"
        icon={ArrowRightIcon}
        iconPosition="right"
        style={{ flex: 1 }}
        disabled={page === 2}
        onPress={() => onPage(page + 1)}
      />
    </View>
  )
}
