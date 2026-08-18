import * as Haptics from 'expo-haptics'
import { VibrateIcon } from 'phosphor-react-native'
import { Platform, Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

const androidHaptics = Object.values(Haptics.AndroidHaptics).map((type) => ({
  label: type
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' '),
  type,
}))

/** Every native Android haptic constant, one button each. */
export function HapticsProbe() {
  return (
    <>
      <Text style={styles.sectionTitle}>Haptics</Text>
      <View style={styles.plainCard}>
        {Platform.OS === 'android' ? (
          <View style={styles.controlGroup}>
            <View style={styles.controlHeader}>
              <View style={styles.rowIcon}>
                <VibrateIcon size={20} color={theme.palette.sky.color} weight="duotone" />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>Android haptics</Text>
                <Text style={styles.rowHint}>Native performHapticFeedback constants</Text>
              </View>
            </View>
            <View style={styles.hapticGrid}>
              {androidHaptics.map((haptic) => (
                <Pressable
                  key={haptic.type}
                  style={styles.hapticButton}
                  onPress={() => void Haptics.performAndroidHapticsAsync(haptic.type)}
                >
                  <Text style={styles.hapticButtonText}>{haptic.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : Platform.OS === 'web' ? (
          <View style={styles.row}>
            <Text style={styles.rowHint}>Haptics not available on web</Text>
          </View>
        ) : (
          <View style={styles.row}>
            <Text style={styles.rowHint}>Android haptic controls only</Text>
          </View>
        )}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  sectionTitle: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 4,
  },
  plainCard: {
    backgroundColor: theme.neutral.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    overflow: 'hidden',
  },
  controlGroup: {
    padding: 14,
    gap: 12,
  },
  controlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: theme.neutral.surfaceDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  rowHint: {
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
  hapticGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hapticButton: {
    backgroundColor: theme.neutral.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  hapticButtonText: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
})
