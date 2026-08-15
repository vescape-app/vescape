import { type ReactNode, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, useWindowDimensions, View } from 'react-native'
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia'
import { EyeIcon, QuestionIcon } from 'phosphor-react-native'
import { useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { TuneProfileFieldValue } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { InfoModal } from '@/components/modals/InfoModal'
import { theme } from '@/constants/theme'
import { TunePreview, TUNE_PREVIEW_DESCRIPTION } from '@/modules/tune/components/TunePreview'
import {
  TunePreviewScenarioControls,
  type HillsPresetId,
} from '@/modules/tune/components/TunePreviewScenarioControls'

const PREVIEW_PINNED_GRADIENT_HEIGHT = 210

interface TunePreviewSectionProps {
  fields: Record<string, TuneProfileFieldValue>
  active: boolean
  visible: boolean
  children: ReactNode
}

export function TunePreviewSection({ fields, active, visible, children }: TunePreviewSectionProps) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const pitchInputDegrees = useSharedValue(0)
  const pitchInputActive = useSharedValue(false)
  const previewSpeedKmh = useSharedValue(15)
  const groundToBoardAngleDegrees = useSharedValue(0)
  const previewGradientColor = theme.palette.slate.bg
  const previewGradientColors = [
    theme.alpha(previewGradientColor, 1),
    theme.alpha(previewGradientColor, 0.75),
    theme.alpha(previewGradientColor, 0),
  ]
  const [hillsPreset, setHillsPreset] = useState<HillsPresetId>('flat')
  const [previewEnabled, setPreviewEnabled] = useState(false)
  const [hillHeightMeters, setHillHeightMeters] = useState(2.5)
  const [hillSpacingMeters, setHillSpacingMeters] = useState(30)
  const [previewPinnedHeight, setPreviewPinnedHeight] = useState(PREVIEW_PINNED_GRADIENT_HEIGHT)
  const hillsEnabled = hillsPreset !== 'flat'
  const [previewHelpVisible, setPreviewHelpVisible] = useState(false)

  if (!visible) return null

  return (
    <View style={styles.tuneView}>
      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        contentInsetAdjustmentBehavior="automatic"
        stickyHeaderIndices={previewEnabled ? [0] : undefined}
      >
        {!previewEnabled ? (
          <View style={styles.previewToggleWrap}>
            <View style={styles.previewToggleCard}>
              <View style={styles.previewToggleTitleRow}>
                <EyeIcon size={16} color={theme.tune.color} weight="duotone" />
                <View style={styles.previewToggleText}>
                  <View style={styles.previewToggleHeading}>
                    <Text style={styles.previewToggleTitle}>Tune Preview</Text>
                    <Pressable
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="About Tune Preview"
                      onPress={() => setPreviewHelpVisible(true)}
                    >
                      <QuestionIcon size={14} color={theme.palette.slate.textMuted} weight="bold" />
                    </Pressable>
                  </View>
                  <Text style={styles.previewToggleDescription}>{TUNE_PREVIEW_DESCRIPTION}</Text>
                </View>
              </View>
              <View style={styles.previewToggleActions}>
                <Switch
                  value={previewEnabled}
                  onValueChange={setPreviewEnabled}
                  trackColor={{
                    false: theme.palette.slate.border,
                    true: theme.alpha(theme.tune.color, 0.6),
                  }}
                  thumbColor={previewEnabled ? theme.tune.color : theme.palette.slate.textMuted}
                  accessibilityLabel="Enable Tune Preview"
                />
              </View>
            </View>
          </View>
        ) : null}
        {previewEnabled ? (
          <View
            style={styles.previewPinned}
            onLayout={(event) => setPreviewPinnedHeight(event.nativeEvent.layout.height)}
          >
            <Canvas style={styles.previewGradient} pointerEvents="none">
              <Rect x={0} y={0} width={width} height={previewPinnedHeight}>
                <LinearGradient
                  start={vec(0, 0)}
                  end={vec(0, previewPinnedHeight)}
                  colors={previewGradientColors}
                  positions={[0, 0.7, 1]}
                />
              </Rect>
            </Canvas>
            <TunePreview
              fields={fields}
              pitchInputDegrees={pitchInputDegrees}
              pitchInputActive={pitchInputActive}
              hillsEnabled={hillsEnabled}
              hillHeightMeters={hillHeightMeters}
              hillSpacingMeters={hillSpacingMeters}
              active={active}
              onDisable={() => setPreviewEnabled(false)}
              onHelp={() => setPreviewHelpVisible(true)}
              speedKmh={previewSpeedKmh}
              groundToBoardAngleDegrees={groundToBoardAngleDegrees}
            />
          </View>
        ) : null}
        <View style={[styles.content, previewEnabled && styles.contentWithPreview]}>
          {previewEnabled ? (
            <TunePreviewScenarioControls
              hillsPreset={hillsPreset}
              onHillsPresetChange={setHillsPreset}
              hillHeightMeters={hillHeightMeters}
              onHillHeightChange={setHillHeightMeters}
              hillSpacingMeters={hillSpacingMeters}
              onHillSpacingChange={setHillSpacingMeters}
              pitchInputDegrees={pitchInputDegrees}
              pitchInputActive={pitchInputActive}
              speedKmh={previewSpeedKmh}
              groundToBoardAngleDegrees={groundToBoardAngleDegrees}
            />
          ) : null}
          {children}
        </View>
      </ScrollView>

      <InfoModal
        visible={previewHelpVisible}
        variant="warning"
        title="Work in progress"
        message={`Tune Editor is a work in progress and is the only place in this app that can change your board's settings.\n\nTune Preview is not a real-world simulation and will never perfectly represent how your board will behave while riding. It is only a comparison tool to help you understand tune behavior and differences between settings.`}
        onDismiss={() => setPreviewHelpVisible(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  tuneView: { flex: 1 },
  formScroll: { flex: 1 },
  previewToggleWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  previewToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    borderRadius: 10,
    padding: 12,
    backgroundColor: theme.palette.slate.surface,
  },
  previewToggleTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewToggleText: { flex: 1, minWidth: 0 },
  previewToggleHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewToggleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  previewToggleTitle: {
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '900',
  },
  previewToggleDescription: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  previewPinned: {
    paddingTop: 0,
    paddingBottom: 0,
    gap: 5,
    overflow: 'hidden',
    zIndex: 1,
  },
  previewGradient: {
    position: 'absolute',
    inset: 0,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  contentWithPreview: {
    marginTop: -18,
    paddingTop: 0,
    zIndex: 2,
  },
})
