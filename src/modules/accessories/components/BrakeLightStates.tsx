import { Pressable, StyleSheet, View } from 'react-native'
import type { BrakeLightMode } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme, type AlphaLevel } from '@/constants/theme'

interface LightState {
  mode: BrakeLightMode
  label: string
  appearance: string
  beam: Beam
}

interface Beam {
  dashes: number
  thickness: number
  alpha: AlphaLevel
  dark?: boolean
}

function lightStates(parked: 'off' | 'glow'): LightState[] {
  return [
    {
      mode: 'not_riding',
      label: 'Parked',
      appearance: parked === 'glow' ? 'Red glow' : 'Off',
      beam:
        parked === 'glow'
          ? { dashes: 1, thickness: 2, alpha: 0.3 }
          : { dashes: 1, thickness: 2, alpha: 0.4, dark: true },
    },
    {
      mode: 'riding',
      label: 'Riding',
      appearance: 'Dim red',
      beam: { dashes: 1, thickness: 2, alpha: 0.6 },
    },
    {
      mode: 'braking',
      label: 'Braking',
      appearance: 'Bright red',
      beam: { dashes: 1, thickness: 3, alpha: 1 },
    },
    {
      mode: 'hard_braking',
      label: 'Hard braking',
      appearance: 'Blinking',
      beam: { dashes: 4, thickness: 3, alpha: 1 },
    },
  ]
}

export interface BrakeLightStatesProps {
  activeMode: BrakeLightMode | null
  previewMode: BrakeLightMode | null
  parked: 'off' | 'glow'
  previewSecondsLeft?: number | null
  disabled?: boolean
  onPreview: (mode: BrakeLightMode | null) => void
}

export function BrakeLightStates({
  activeMode,
  previewMode,
  parked,
  previewSecondsLeft,
  disabled,
  onPreview,
}: BrakeLightStatesProps) {
  return (
    <View style={styles.grid}>
      {lightStates(parked).map((state) => {
        const live = state.mode === activeMode
        const held = state.mode === previewMode
        return (
          <Pressable
            key={state.mode}
            style={({ pressed }) => [
              styles.tile,
              live && styles.tileLive,
              held && styles.tileHeld,
              disabled && styles.tileDisabled,
              pressed && !disabled && styles.tilePressed,
            ]}
            disabled={disabled}
            onPress={() => onPreview(held ? null : state.mode)}
            accessibilityRole="button"
            accessibilityState={{ selected: live, disabled }}
            accessibilityLabel={`${state.label}, ${state.appearance}${live ? ', showing now' : ''}`}
            testID={`brake-light-state-${state.mode}`}
          >
            <BeamStrip beam={state.beam} />
            <Text style={styles.tileLabel} numberOfLines={1}>
              {state.label}
            </Text>
            <Text style={styles.tileAppearance} numberOfLines={1}>
              {state.appearance}
            </Text>
            {held ? (
              <Text style={styles.tileTag}>
                {previewSecondsLeft == null ? 'HELD' : `HELD ${previewSecondsLeft}s`}
              </Text>
            ) : live ? (
              <Text style={styles.tileTagLive}>NOW</Text>
            ) : (
              <Text style={styles.tileTagIdle}>Tap to test</Text>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

function BeamStrip({ beam }: { beam: Beam }) {
  const color = beam.dark
    ? theme.alpha(theme.neutral.textDim, beam.alpha)
    : theme.alpha(theme.palette.red.light, beam.alpha)

  return (
    <View style={styles.beam}>
      {Array.from({ length: beam.dashes }, (_, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            height: beam.thickness,
            borderRadius: beam.thickness / 2,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surface,
  },
  tileLive: {
    borderColor: theme.alpha(theme.palette.red.color, 0.6),
    backgroundColor: theme.alpha(theme.palette.red.color, 0.1),
  },
  tileHeld: { borderColor: theme.palette.red.color },
  tileDisabled: { opacity: 0.45 },
  tilePressed: { opacity: 0.7 },
  beam: {
    width: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 10,
    marginBottom: 4,
  },
  tileLabel: {
    color: theme.neutral.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  tileAppearance: {
    color: theme.neutral.textSecondary,
    fontSize: 11,
  },
  tileTag: {
    color: theme.palette.red.light,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  tileTagLive: {
    color: theme.neutral.textSecondary,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  tileTagIdle: {
    color: theme.neutral.textDim,
    fontSize: 9,
    fontWeight: '600',
  },
})
