import Constants from 'expo-constants'
import { NewspaperClippingIcon } from 'phosphor-react-native'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Markdown } from '@/components/base/Markdown'
import { Placeholder } from '@/components/base/Placeholder'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { bundledReleaseNotes } from '@/modules/release/generated/releaseNotes'
import { selectReleaseNotes } from '@/modules/release/lib/releaseNotes'

const installedVersion = Constants.expoConfig?.version

export function ReleaseNotesScreen() {
  const notes = selectReleaseNotes(bundledReleaseNotes, installedVersion)

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {notes.length === 0 ? (
          <Placeholder
            icon={NewspaperClippingIcon}
            title="No release notes yet"
            description="Future app updates will appear here."
          />
        ) : (
          notes.map((note) => (
            <View key={note.version} style={styles.release}>
              <Text style={styles.version}>{note.version}</Text>
              <Markdown>{note.markdown}</Markdown>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.palette.slate.bg,
  },
  content: {
    flexGrow: 1,
    padding: 16,
    gap: 28,
  },
  release: {
    gap: 8,
  },
  version: {
    color: theme.palette.sky.text,
    fontSize: 18,
    fontWeight: '700',
  },
})
