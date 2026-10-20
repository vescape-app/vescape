// Visual scale guide; provisional calibration does not predict rider experience.
import { StyleSheet, View } from 'react-native'
import Svg, { Circle, Defs } from 'react-native-svg'
import { TuneRingGradient } from './TuneRingGradient'
import { Text } from '@/components/base/Text'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

const FEEL_GUIDES = [
  [
    ['Soft & flowing', 'More give underfoot, with calmer, less abrupt responses.'],
    ['Firm & direct', 'Firmer support underfoot, with sharper responses to your movement.'],
  ],
  [
    [
      'Slow & nose-down',
      'More nose lift under braking; turns lower the nose. Slower tilt response.',
    ],
    [
      'Quick & nose-up',
      'Less extra nose lift under braking; turns raise the nose. Faster tilt response.',
    ],
  ],
  [
    ['Gentle adjustment', 'Subtle angle changes on climbs and descents.'],
    ['Stronger adjustment', 'More nose lift uphill, more nose drop downhill.'],
  ],
]
export function TuneRingFeelGuide({ page, color }: { page: number; color: string }) {
  const neutral = useResolvedNeutralColors()
  return (
    <View style={styles.row}>
      {FEEL_GUIDES[page].map(([title, description], index) => (
        <View key={title} style={styles.example}>
          <View style={styles.exampleHeading}>
            <Svg width={30} height={30}>
              <Defs>
                <TuneRingGradient id={`feel-${index}`} color={color} compact />
              </Defs>
              <Circle
                cx={15}
                cy={15}
                r={index === 0 ? 8 : 13}
                fill={`url(#feel-${index})`}
                stroke={color}
                strokeOpacity={0.5}
                strokeWidth={1}
              />
              <Circle cx={15} cy={15} r={1.5} fill={color} />
            </Svg>
            <Text style={[styles.title, { color: neutral.textPrimary }]}>{title}</Text>
          </View>
          <Text style={[styles.description, { color: neutral.textMuted }]}>{description}</Text>
        </View>
      ))}
    </View>
  )
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 16, paddingBottom: 0 },
  example: { flex: 1, alignItems: 'center', gap: 4 },
  exampleHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 32,
  },
  title: { fontSize: 12, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  description: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
})
