import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SpeakerHighIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import { AlertSoundProbe } from '@/screens/showcase/sounds/AlertSoundProbe'
import { TtsProbe } from '@/screens/showcase/sounds/TtsProbe'
import { VoiceProbe, WeatherProbe } from '@/screens/showcase/sounds/VoiceProbe'

export default function AlertSoundsDevScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={SpeakerHighIcon}
          description="Severity sounds, Geiger, voice lines and TTS, played without a board."
        />
        <VoiceProbe />
        <WeatherProbe />
        <AlertSoundProbe />
        <TtsProbe />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
    gap: 8,
  },
})
