import { Pressable, View } from 'react-native'
import { WarningCircleIcon } from 'phosphor-react-native'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

export function TuneEditorNotices({
  error,
  schemaMismatchFields,
  showBadgeInfo,
}: {
  error: string | null
  schemaMismatchFields: { profileOnly: string[]; boardOnly: string[] } | null
  showBadgeInfo: (title: string, message: string) => void
}) {
  return (
    <>
      {error ? (
        <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
          <WarningCircleIcon size={16} color={theme.status.error.color} />
          <Text style={{ color: theme.status.error.text, flex: 1 }}>{error}</Text>
        </View>
      ) : null}

      {schemaMismatchFields ? (
        <Pressable
          style={{ flexDirection: 'row', gap: 10, padding: 12 }}
          onPress={() =>
            showBadgeInfo(
              'Schema Mismatch',
              `Profile and board have different field sets.${
                schemaMismatchFields.profileOnly.length > 0
                  ? `\n\nIn profile but not board: ${schemaMismatchFields.profileOnly.join(', ')}`
                  : ''
              }${
                schemaMismatchFields.boardOnly.length > 0
                  ? `\n\nIn board but not profile: ${schemaMismatchFields.boardOnly.join(', ')}`
                  : ''
              }`,
            )
          }
        >
          <WarningCircleIcon size={16} color={theme.palette.yellow.color} weight="fill" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.palette.yellow.text }}>Schema mismatch</Text>
            <Text style={{ color: theme.palette.yellow.color }}>
              {schemaMismatchFields.profileOnly.length > 0
                ? `${schemaMismatchFields.profileOnly.length} field${schemaMismatchFields.profileOnly.length === 1 ? '' : 's'} in profile not on board`
                : ''}
              {schemaMismatchFields.profileOnly.length > 0 &&
              schemaMismatchFields.boardOnly.length > 0
                ? ' · '
                : ''}
              {schemaMismatchFields.boardOnly.length > 0
                ? `${schemaMismatchFields.boardOnly.length} new field${schemaMismatchFields.boardOnly.length === 1 ? '' : 's'} on board`
                : ''}
            </Text>
          </View>
        </Pressable>
      ) : null}
    </>
  )
}
