import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ArrowFatLinesUpIcon, ArrowRightIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { Markdown } from '@/components/base/Markdown'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

interface AppBlockScreenProps {
  message: string
  installedVersion: string
  latestVersion: string
  onUpdate: () => void
}

export function AppBlockScreen({
  message,
  installedVersion,
  latestVersion,
  onUpdate,
}: AppBlockScreenProps) {
  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {}}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.badge}>
            <ArrowFatLinesUpIcon size={28} color={theme.status.upgrade.color} weight="bold" />
          </View>
          <Text style={styles.title}>Update required</Text>
          <View style={styles.versions}>
            <Text style={styles.versionFrom}>v{installedVersion}</Text>
            <ArrowRightIcon size={14} color={theme.neutral.textMuted} weight="bold" />
            <Text style={styles.versionTo}>v{latestVersion}</Text>
          </View>
        </View>
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <Markdown align="center">{message}</Markdown>
        </ScrollView>
        <Button
          label="Update Vescape"
          variant="tune"
          icon={ArrowFatLinesUpIcon}
          onPress={onUpdate}
        />
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
    padding: 24,
    gap: 20,
  },
  header: {
    alignItems: 'center',
    gap: 14,
    paddingTop: 24,
  },
  badge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.status.upgrade.bg,
    borderWidth: 1,
    borderColor: theme.status.upgrade.border,
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  versions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  versionFrom: {
    color: theme.neutral.textMuted,
    fontSize: 14,
  },
  versionTo: {
    color: theme.palette.purple.light,
    fontSize: 14,
    fontWeight: '700',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingBottom: 12,
  },
})
