import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { PlayIcon, StopIcon } from 'phosphor-react-native'
import {
  getAlertSounds,
  previewAlertSound,
  startGeigerSimulation,
  stopGeigerSimulation,
  type AlertSound,
} from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import { TuneDial } from '@/modules/tune/components/TuneDial'

type PlaybackMode = 'single' | 'geiger'

function PresetButton({
  preset,
  selected,
  onPress,
}: {
  preset: AlertSound
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      style={[styles.presetButton, selected && styles.presetButtonActive]}
      onPress={onPress}
    >
      <Text style={[styles.presetName, selected && styles.presetNameActive]}>{preset.name}</Text>
      <Text style={styles.presetCategory}>{preset.category}</Text>
    </Pressable>
  )
}

/** Alert sound presets, single playback, and the Geiger simulation with its range depth. */
export function AlertSoundProbe() {
  const accents = useResolvedAccentColors()
  const presets = useMemo(() => getAlertSounds(), [])
  const singlePresets = useMemo(
    () => presets.filter((preset) => preset.category === 'single'),
    [presets],
  )
  const geigerPresets = useMemo(
    () => presets.filter((preset) => preset.category === 'geiger'),
    [presets],
  )
  const [selectedUri, setSelectedUri] = useState<string>(singlePresets[0]?.uri ?? 'preset:beep')
  const [mode, setMode] = useState<PlaybackMode>('single')
  const [rangeDepth, setRangeDepth] = useState(0.5)
  const [geigerActive, setGeigerActive] = useState(false)

  const visiblePresets = mode === 'single' ? singlePresets : geigerPresets
  const selectedPreset = visiblePresets.find((p) => p.uri === selectedUri) ?? visiblePresets[0]

  useEffect(() => stopGeigerSimulation, [])

  const handlePlaySingle = useCallback(() => {
    previewAlertSound(selectedUri)
  }, [selectedUri])

  const handleStopGeiger = useCallback(() => {
    stopGeigerSimulation()
    setGeigerActive(false)
  }, [])

  const handleToggleGeiger = useCallback(() => {
    if (geigerActive) {
      handleStopGeiger()
      return
    }
    startGeigerSimulation(selectedUri, rangeDepth)
    setGeigerActive(true)
  }, [geigerActive, handleStopGeiger, rangeDepth, selectedUri])

  const handleRangeDepthChange = useCallback(
    (value: number) => {
      setRangeDepth(value)
      if (geigerActive) startGeigerSimulation(selectedUri, value)
    },
    [geigerActive, selectedUri],
  )

  const selectMode = useCallback(
    (next: PlaybackMode) => {
      if (geigerActive) handleStopGeiger()
      setMode(next)
      const nextPresets = next === 'single' ? singlePresets : geigerPresets
      setSelectedUri(nextPresets[0]?.uri ?? 'preset:beep')
    },
    [geigerActive, geigerPresets, handleStopGeiger, singlePresets],
  )

  return (
    <>
      <Text style={styles.sectionTitle}>Sound Preset</Text>
      <View style={styles.card}>
        <View style={styles.presetGrid}>
          {visiblePresets.map((preset) => (
            <PresetButton
              key={preset.uri}
              preset={preset}
              selected={selectedUri === preset.uri}
              onPress={() => {
                if (geigerActive) handleStopGeiger()
                setSelectedUri(preset.uri)
              }}
            />
          ))}
        </View>
      </View>

      <Text style={styles.sectionTitle}>Playback Mode</Text>
      <View style={styles.card}>
        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeButton, mode === 'single' && styles.modeButtonActive]}
            onPress={() => selectMode('single')}
          >
            <Text style={[styles.modeText, mode === 'single' && styles.modeTextActive]}>
              Single Play
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeButton, mode === 'geiger' && styles.modeButtonActive]}
            onPress={() => selectMode('geiger')}
          >
            <Text style={[styles.modeText, mode === 'geiger' && styles.modeTextActive]}>
              Geiger Simulation
            </Text>
          </Pressable>
        </View>
      </View>

      {mode === 'single' ? (
        <>
          <Text style={styles.sectionTitle}>Play</Text>
          <View style={styles.card}>
            <Pressable
              style={[styles.playButton, { backgroundColor: accents.sky.solid }]}
              onPress={handlePlaySingle}
            >
              <PlayIcon size={20} color={accents.sky.onSolid} weight="fill" />
              <Text style={[styles.playButtonText, { color: accents.sky.onSolid }]}>
                Play {selectedPreset?.name ?? selectedUri}
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Geiger Simulation</Text>
          <View style={styles.card}>
            <View style={styles.dialSection}>
              <View style={styles.dialHeader}>
                <Text style={styles.dialLabel}>Range Depth</Text>
                <Text style={styles.dialValue}>{rangeDepth.toFixed(2)}</Text>
              </View>
              <TuneDial
                value={rangeDepth}
                min={0}
                max={1}
                step={0.01}
                onValueChange={handleRangeDepthChange}
              />
            </View>

            <Pressable
              style={[
                styles.playButton,
                { backgroundColor: geigerActive ? accents.red.solid : accents.sky.solid },
              ]}
              onPress={handleToggleGeiger}
            >
              {geigerActive ? (
                <StopIcon size={20} color={accents.red.onSolid} weight="fill" />
              ) : (
                <PlayIcon size={20} color={accents.sky.onSolid} weight="fill" />
              )}
              <Text
                style={[
                  styles.playButtonText,
                  { color: geigerActive ? accents.red.onSolid : accents.sky.onSolid },
                ]}
              >
                {geigerActive ? 'Stop' : 'Start Geiger'}
              </Text>
            </Pressable>
          </View>
        </>
      )}
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
  card: {
    backgroundColor: theme.neutral.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    overflow: 'hidden',
    padding: 14,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetButton: {
    backgroundColor: theme.neutral.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 2,
  },
  presetButtonActive: {
    borderColor: theme.palette.sky.color,
    backgroundColor: theme.palette.sky.bg,
  },
  presetName: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  presetNameActive: {
    color: theme.neutral.textPrimary,
  },
  presetCategory: {
    color: theme.neutral.textDim,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 0,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.neutral.border,
  },
  modeButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  modeButtonActive: {
    backgroundColor: theme.palette.sky.bg,
  },
  modeText: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  modeTextActive: {
    color: theme.neutral.textPrimary,
  },
  playButton: {
    backgroundColor: theme.palette.sky.color,
    borderRadius: 8,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playButtonText: {
    color: theme.palette.sky.bg,
    fontSize: 15,
    fontWeight: '700',
  },
  dialSection: {
    gap: 8,
    marginBottom: 14,
  },
  dialHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dialLabel: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  dialValue: {
    color: theme.palette.sky.text,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
})
