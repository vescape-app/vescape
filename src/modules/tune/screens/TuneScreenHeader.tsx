import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { useRef, useState } from 'react'
import {
  CircuitryIcon,
  DotsThreeIcon,
  PlusIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  PencilSimpleIcon,
  TrashIcon,
} from 'phosphor-react-native'
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'

import { IconButton } from '@/components/base/IconButton'
import { Button } from '@/components/base/Button'
import { Select } from '@/components/forms/Select'
import { Dropdown } from '@/components/forms/Dropdown'
import { theme } from '@/constants/theme'
import { Text } from '@/components/base/Text'
import { TuneProfilePill } from '../components/TuneProfilePill'
import { HeaderBackButton } from '@/components/base/HeaderBackButton'
import {
  tuneProfileColorTheme,
  tuneProfileIconComponent,
} from '@/modules/tune/components/TuneProfileMetadataModal'
import type { useTuneModals } from '@/modules/tune/hooks/useTuneModals'
import type { useTuneScreenData } from '@/modules/tune/hooks/useTuneScreenData'

type TuneScreenData = ReturnType<typeof useTuneScreenData>

/** Profile pills, plus history and re-read actions. Rendered as the navigator's own header. */
export function TuneScreenHeader({
  paddingTop,
  activeProfile,
  profiles,
  modals,
  onOpenBoards,
  onOpenHistory,
  mode,
  onModeChange,
}: {
  mode?: 'rings' | 'floaty' | 'advanced'
  onModeChange?: (mode: 'rings' | 'floaty' | 'advanced') => void
  onOpenBoards: () => void
  paddingTop: number
  profiles: TuneScreenData['profiles']
  activeProfile: TuneScreenData['activeProfile']
  boardConnected: TuneScreenData['boardConnected']
  boardSnapshotStatus: TuneScreenData['boardSnapshotStatus']
  firmwareCommandsTrusted: TuneScreenData['firmwareCommandsTrusted']
  modals: ReturnType<typeof useTuneModals>
  onSelectProfile: (profileId: string) => void
  onOpenHistory: () => void
  onReadBoard: () => void
}) {
  const neutral = useResolvedNeutralColors()
  const { fontScale } = useWindowDimensions()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<View>(null)
  const action = (callback: () => void) => {
    setMenuOpen(false)
    callback()
  }
  return (
    <View style={[styles.header, { paddingTop, backgroundColor: neutral.bg }]}>
      <HeaderBackButton />
      <View style={styles.headerCenter}>
        {mode && onModeChange ? (
          <Select
            testID="tune-mode"
            value={mode}
            onChange={onModeChange}
            options={[
              { value: 'rings', label: 'Rings' },
              { value: 'floaty', label: 'Floaty' },
              { value: 'advanced', label: 'Advanced' },
            ]}
            style={{ width: 168 * Math.max(1, fontScale), maxWidth: '100%', borderRadius: 24 }}
          />
        ) : (
          <Text style={styles.headerTitle}>Tune</Text>
        )}
      </View>
      <View ref={menuRef} collapsable={false}>
        <IconButton
          icon={DotsThreeIcon}
          accessibilityLabel="Tune menu"
          testID="tune-menu"
          onPress={() => setMenuOpen(true)}
        />
      </View>
      <Dropdown
        visible={menuOpen}
        triggerRef={menuRef}
        onClose={() => setMenuOpen(false)}
        matchTriggerWidth={false}
        minWidth={220}
      >
        <View style={{ padding: 8, gap: 6 }}>
          {activeProfile ? (
            <>
              <Button
                icon={ClockCounterClockwiseIcon}
                label="Tune history"
                variant="secondary"
                onPress={() => action(onOpenHistory)}
              />
              <Button
                icon={PencilSimpleIcon}
                label="Edit tune metadata"
                variant="secondary"
                onPress={() => action(() => modals.setMetadataModalProfile(activeProfile))}
              />
              {modals.otherBoards.length > 0 ? (
                <Button
                  icon={CopyIcon}
                  label="Copy to board"
                  variant="secondary"
                  onPress={() => action(() => modals.setCopySourceProfile(activeProfile))}
                />
              ) : null}
              {profiles.length > 1 ? (
                <Button
                  icon={TrashIcon}
                  label="Delete tune"
                  variant="destructive"
                  onPress={() => action(() => modals.setDeleteConfirmProfile(activeProfile))}
                />
              ) : null}
            </>
          ) : null}
          <Button
            icon={CircuitryIcon}
            label="Select tune board"
            variant="secondary"
            onPress={() => action(onOpenBoards)}
          />
        </View>
      </Dropdown>
    </View>
  )
}

export function TuneProfileSelector({
  profiles,
  activeProfile,
  modals,
  onSelectProfile,
}: Pick<
  Parameters<typeof TuneScreenHeader>[0],
  'profiles' | 'activeProfile' | 'modals' | 'onSelectProfile'
>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        gap: 8,
        alignItems: 'center',
        paddingHorizontal: 2,
      }}
    >
      {profiles.map((profile) => (
        <TuneProfilePill
          key={profile.id}
          label={profile.name}
          icon={tuneProfileIconComponent(profile.icon)}
          color={tuneProfileColorTheme(profile.color)}
          active={profile.id === activeProfile?.id}
          onPress={() => onSelectProfile(profile.id)}
        />
      ))}
      <IconButton
        size="md"
        icon={PlusIcon}
        accessibilityLabel="Add tune"
        onPress={() => modals.handleCreateProfile(activeProfile?.id)}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingBottom: 0,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: theme.neutral.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
})
