import { createElement } from 'react'
import { View, useWindowDimensions } from 'react-native'
import {
  ArrowCounterClockwiseIcon,
  DownloadSimpleIcon,
  ArrowsClockwiseIcon,
  CheckIcon,
  LinkIcon,
  LinkBreakIcon,
  QuestionIcon,
} from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import {
  useColoredAction,
  useColoredActionForeground,
  useResolvedNeutralColors,
} from '@/hooks/useTheme'
import { theme } from '@/constants/theme'
import { TuneProfileSelector, type TuneScreenHeader } from '../screens/TuneScreenHeader'
import { tuneProfileColorTheme, tuneProfileIconComponent } from './TuneProfileMetadataModal'

export function TuneEditorFooter({
  selector,
  dirtyCount,
  saving,
  busy,
  reading = false,
  canRead,
  canSend,
  boardState,
  boardConnected,
  onSave,
  onDiscard,
  onRead,
  onSend,
}: {
  selector: Pick<
    Parameters<typeof TuneScreenHeader>[0],
    'profiles' | 'activeProfile' | 'modals' | 'onSelectProfile'
  >
  dirtyCount: number
  saving: boolean
  busy: boolean
  reading?: boolean
  canRead: boolean
  canSend: boolean
  boardState: 'match' | 'different' | 'unknown'
  boardConnected: boolean
  onSave: () => void
  onDiscard: () => void
  onRead: () => void
  onSend: () => void
}) {
  const neutral = useResolvedNeutralColors()
  const profile = selector.activeProfile
  const tint = tuneProfileColorTheme(profile?.color)
  const backgroundColor = useColoredAction(tint.color)
  const borderColor = useColoredActionForeground(tint.color)
  const color = borderColor
  const { width, fontScale } = useWindowDimensions()
  // Preserve the reference's single capsule row whenever readable text fits.
  const stacked = (width - 108) / Math.max(1, fontScale) < 280
  const narrow = width < 440
  const Badge =
    boardState === 'match' ? LinkIcon : boardState === 'different' ? LinkBreakIcon : QuestionIcon
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: narrow ? 6 : 8,
        paddingHorizontal: narrow ? 8 : 12,
        paddingVertical: 10,
        backgroundColor: neutral.bg,
      }}
    >
      <IconButton
        size={narrow ? 'sm' : 'md'}
        icon={DownloadSimpleIcon}
        accessibilityLabel="Read from board"
        testID="tune-read-board"
        loading={busy && reading}
        onPress={onRead}
        disabled={!canRead || busy || saving}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        {dirtyCount ? (
          <View
            style={{
              alignItems: 'center',
              flexDirection: stacked ? 'column' : 'row',
              justifyContent: 'space-between',
              gap: 6,
              paddingVertical: 8,
              paddingHorizontal: 10,
              borderWidth: 1,
              borderRadius: 32,
              borderColor,
              backgroundColor,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                flexShrink: 1,
                flex: stacked ? undefined : 1,
                maxWidth: '100%',
              }}
            >
              {createElement(tuneProfileIconComponent(profile?.icon), {
                size: stacked ? 20 : 18,
                color,
              })}
              <View style={{ flexShrink: 1, gap: 2 }}>
                <Text numberOfLines={1} style={{ color, flexShrink: 1, fontWeight: '700' }}>
                  {profile?.name}
                </Text>
                <Text
                  testID="tune-dirty-count"
                  accessibilityLabel={`Changed raw fields: ${dirtyCount}`}
                  numberOfLines={1}
                  style={{ color, fontSize: 10, opacity: 0.8 }}
                >
                  {dirtyCount} {dirtyCount === 1 ? 'field changed' : 'fields changed'}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
              <Button
                label="Discard"
                testID="tune-discard"
                icon={ArrowCounterClockwiseIcon}
                variant="destructive"
                size="sm"
                style={{ height: 36, paddingHorizontal: 10 }}
                onPress={onDiscard}
                disabled={saving || busy}
              />
              <Button
                label="Save"
                testID="tune-save"
                icon={CheckIcon}
                accent={tint.color}
                size="sm"
                style={{ height: 36, paddingHorizontal: 10 }}
                onPress={onSave}
                loading={saving}
                disabled={busy}
              />
            </View>
          </View>
        ) : (
          <TuneProfileSelector {...selector} />
        )}
      </View>
      <View>
        <IconButton
          size={narrow ? 'sm' : 'md'}
          icon={ArrowsClockwiseIcon}
          accessibilityLabel={
            boardConnected ? `Send to board; ${boardState}` : 'Send to board; disconnected'
          }
          testID="tune-send-board"
          onPress={onSend}
          disabled={!canSend || busy || saving}
          loading={busy && !reading}
        />
        {boardConnected ? (
          <View
            testID="tune-board-match-badge"
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              backgroundColor: neutral.bg,
              borderRadius: 8,
            }}
          >
            <Badge
              size={14}
              color={boardState === 'match' ? theme.status.success.color : neutral.textMuted}
            />
          </View>
        ) : null}
      </View>
    </View>
  )
}
