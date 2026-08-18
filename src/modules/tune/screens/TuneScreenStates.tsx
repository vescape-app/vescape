import { ActivityIndicator, StyleSheet, View } from 'react-native'
import {
  ArrowsClockwiseIcon,
  BluetoothSlashIcon,
  FadersIcon,
  WarningCircleIcon,
} from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import type { useTuneScreenData } from '@/modules/tune/hooks/useTuneScreenData'

type TuneScreenData = ReturnType<typeof useTuneScreenData>

/** What the screen shows before there is a profile to edit: no board, loading, empty, or failed. */
export function TuneScreenStates({
  hasTuneView,
  boardsLoaded,
  selectedBoardId,
  profileState,
  boardSnapshot,
  firmwareCommandsTrusted,
  firmwareCommandBlockReason,
  loadOnline,
  loadOffline,
  onCreateFirstProfile,
}: {
  hasTuneView: boolean
  boardsLoaded: TuneScreenData['boardsLoaded']
  selectedBoardId: TuneScreenData['selectedBoardId']
  profileState: TuneScreenData['profileState']
  boardSnapshot: TuneScreenData['boardSnapshot']
  firmwareCommandsTrusted: TuneScreenData['firmwareCommandsTrusted']
  firmwareCommandBlockReason: TuneScreenData['firmwareCommandBlockReason']
  loadOnline: TuneScreenData['loadOnline']
  loadOffline: TuneScreenData['loadOffline']
  onCreateFirstProfile: () => void
}) {
  return (
    <>
      {!selectedBoardId && boardsLoaded && !hasTuneView ? (
        <Placeholder
          icon={BluetoothSlashIcon}
          title="No board selected"
          description="Select a board to edit its saved Tune Profile"
        />
      ) : null}

      {profileState.phase === 'loading' && !hasTuneView && selectedBoardId ? (
        <View style={styles.mainState}>
          <ActivityIndicator color={theme.palette.sky.color} />
          <Text style={styles.stateText}>Loading saved tune profile...</Text>
        </View>
      ) : null}

      {profileState.phase === 'empty' ? (
        <View style={styles.mainState}>
          <Placeholder
            icon={FadersIcon}
            title="Create tune based on board config"
            description={
              firmwareCommandBlockReason ??
              'Connect to your board to read its current configuration and create your first Tune Profile'
            }
            action={
              boardSnapshot?.refloatBaseVersion && firmwareCommandsTrusted ? (
                <Button
                  label="Create first profile"
                  icon={FadersIcon}
                  variant="tune"
                  size="lg"
                  style={styles.firstProfileAction}
                  onPress={onCreateFirstProfile}
                />
              ) : null
            }
          />
        </View>
      ) : null}

      {profileState.phase === 'error' && !hasTuneView ? (
        <View style={styles.mainState}>
          <WarningCircleIcon size={28} color={theme.status.error.text} />
          <Text selectable style={styles.errorText}>
            {profileState.error}
          </Text>
          <Button
            label="Retry"
            icon={ArrowsClockwiseIcon}
            onPress={() => {
              if (profileState.retry === 'online') {
                void loadOnline()
              } else if (selectedBoardId) {
                void loadOffline(selectedBoardId)
              }
            }}
          />
        </View>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  mainState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  stateText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 15,
  },
  errorText: {
    color: theme.status.error.text,
    fontSize: 15,
    textAlign: 'center',
  },
  firstProfileAction: {
    minWidth: 240,
  },
})
