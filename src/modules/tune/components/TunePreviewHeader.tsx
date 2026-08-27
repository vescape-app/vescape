import { EyeIcon, QuestionIcon } from 'phosphor-react-native'
import { Canvas, Text as SkiaText } from '@shopify/react-native-skia'
import { Pressable, StyleSheet, Switch, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import type { SkFont } from '@shopify/react-native-skia'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import {
  useResolvedAccentColors,
  useResolvedNeutralColors,
  useResolvedTelemetryColors,
} from '@/hooks/useTheme'
import {
  LEGEND_VALUE_WIDTH,
  READOUT_BASELINE,
  READOUT_HEIGHT,
  SPEED_BASELINE,
  SPEED_HEIGHT,
  SPEED_WIDTH,
} from '@/modules/tune/components/tunePreviewCanvasGeometry'

/** Title, live speed, the enable switch, and the board/target/motor legend. */
export function TunePreviewHeader({
  speedStr,
  boardAngleStr,
  targetAngleStr,
  currentStr,
  speedFont,
  readoutFont,
  readoutBoldFont,
  onHelp,
  onDisable,
  description,
}: {
  speedStr: SharedValue<string>
  boardAngleStr: SharedValue<string>
  targetAngleStr: SharedValue<string>
  currentStr: SharedValue<string>
  speedFont: SkFont | null
  readoutFont: SkFont | null
  readoutBoldFont: SkFont | null
  onHelp?: () => void
  onDisable?: () => void
  description: string
}) {
  const accents = useResolvedAccentColors()
  const neutral = useResolvedNeutralColors()
  const telemetry = useResolvedTelemetryColors()
  return (
    <View style={styles.header}>
      <View style={styles.titleBlock}>
        <View style={styles.identityRow}>
          <EyeIcon size={16} color={theme.tune.color} weight="duotone" />
          <View style={styles.identityText}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Tune Preview</Text>
              <Pressable hitSlop={8} onPress={onHelp}>
                <QuestionIcon size={14} color={theme.palette.slate.textMuted} weight="bold" />
              </Pressable>
            </View>
            <Text style={styles.subtitle}>{description}</Text>
          </View>
          <View style={styles.speedReadout}>
            <Canvas style={styles.speedCanvas}>
              {speedFont && (
                <SkiaText
                  x={0}
                  y={SPEED_BASELINE}
                  text={speedStr}
                  font={speedFont}
                  color={telemetry.speed}
                />
              )}
            </Canvas>
            <Text style={styles.speedUnit}>km/h</Text>
          </View>
          {onDisable ? (
            <Switch
              value
              onValueChange={(enabled) => {
                if (!enabled) onDisable()
              }}
              trackColor={{
                false: neutral.border,
                true: theme.alpha(accents.purple.color, 0.6),
              }}
              thumbColor={accents.purple.color}
              accessibilityLabel="Disable Tune Preview"
            />
          ) : null}
        </View>
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={styles.boardSwatch} />
            <Text style={styles.boardLegendText}>Board </Text>
            <Canvas style={styles.legendValueCanvas}>
              {readoutFont && (
                <SkiaText
                  x={0}
                  y={READOUT_BASELINE}
                  text={boardAngleStr}
                  font={readoutFont}
                  color={accents.sky.color}
                />
              )}
            </Canvas>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.targetSwatch} />
            <Text style={styles.targetLegendText}>Target </Text>
            <Canvas style={styles.legendValueCanvas}>
              {readoutFont && (
                <SkiaText
                  x={0}
                  y={READOUT_BASELINE}
                  text={targetAngleStr}
                  font={readoutFont}
                  color={accents.purple.light}
                />
              )}
            </Canvas>
          </View>
        </View>
        <View style={styles.motorReadout}>
          <Text style={styles.motorLabel}>Motor</Text>
          <Canvas style={styles.legendValueCanvas}>
            {readoutFont && (
              <SkiaText
                x={0}
                y={READOUT_BASELINE}
                text={currentStr}
                font={readoutFont}
                color={telemetry.motorCurrent}
              />
            )}
          </Canvas>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  titleBlock: { flex: 1, gap: 2 },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  speedReadout: {
    alignItems: 'flex-end',
    gap: 1,
  },
  speedCanvas: {
    width: SPEED_WIDTH,
    height: SPEED_HEIGHT,
  },
  speedUnit: {
    color: theme.palette.slate.textMuted,
    fontSize: 8,
    fontWeight: '700',
  },
  legend: { alignItems: 'flex-start', gap: 2, marginTop: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  boardSwatch: { width: 18, height: 1, backgroundColor: theme.palette.sky.color },
  boardLegendText: {
    color: theme.palette.sky.color,
    fontSize: 9,
  },
  targetSwatch: {
    width: 18,
    height: 1,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.palette.purple.light,
  },
  targetLegendText: {
    color: theme.palette.purple.light,
    fontSize: 9,
  },
  legendValueCanvas: {
    width: LEGEND_VALUE_WIDTH,
    height: READOUT_HEIGHT,
  },
  motorReadout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  motorLabel: {
    color: theme.telemetry.motorCurrent,
    fontSize: 9,
  },
})
