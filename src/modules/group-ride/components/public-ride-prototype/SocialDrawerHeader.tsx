import { Pressable, StyleSheet, View } from 'react-native'
import { ArrowLeftIcon, UsersThreeIcon } from 'phosphor-react-native'
import Animated, { FadeInRight, FadeOutRight, ReduceMotion } from 'react-native-reanimated'
import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

const ENTER = FadeInRight.duration(220).reduceMotion(ReduceMotion.System)
const EXIT = FadeOutRight.duration(180).reduceMotion(ReduceMotion.System)

/** Social-only trial of breadcrumb navigation inside an edge drawer. */
export function SocialDrawerHeader({
  riderName,
  onBack,
  onClose,
}: {
  riderName?: string
  onBack: () => void
  onClose: () => void
}) {
  const neutral = useResolvedNeutralColors()
  return (
    <View style={styles.container}>
      {riderName ? (
        <IconButton
          icon={ArrowLeftIcon}
          onPress={onBack}
          accessibilityLabel="Back to Social"
          testID="social-page-back"
          style={styles.back}
        />
      ) : null}
      <Pressable
        style={styles.header}
        onPress={riderName ? onBack : onClose}
        accessibilityRole="button"
        accessibilityLabel={riderName ? `Back to Social from ${riderName}` : 'Close Social'}
        testID={riderName ? 'social-breadcrumb-back' : 'social-close'}
      >
        <UsersThreeIcon size={28} color={neutral.textSecondary} weight="duotone" />
        <Text
          style={[styles.title, { color: riderName ? neutral.textSecondary : neutral.textPrimary }]}
        >
          Social
        </Text>
        {riderName ? (
          <Animated.View key={riderName} entering={ENTER} exiting={EXIT} style={styles.breadcrumb}>
            <Text style={[styles.slash, { color: neutral.textSecondary }]}>/</Text>
            <Text numberOfLines={1} style={[styles.detail, { color: neutral.textPrimary }]}>
              {riderName}
            </Text>
          </Animated.View>
        ) : null}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 44,
  },
  back: { position: 'absolute', left: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '100%', minHeight: 48 },
  title: { fontSize: 22, fontWeight: '300' },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  slash: { fontSize: 22, fontWeight: '300' },
  detail: { fontSize: 20, fontWeight: '600', flexShrink: 1 },
})
