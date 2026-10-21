import { Pressable, StyleSheet, View } from 'react-native'
import type { BrakeLightMode } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme, type AlphaLevel } from '@/constants/theme'

interface LightState {
  mode: BrakeLightMode
  label: string
  /** What the rider should see on the light itself, not what the app asked for. */
  appearance: string
  /** The strip that stands for this state: how bright, how thick, and whether it is broken up. */
  beam: Beam
}

interface Beam {
  /** One unbroken bar for a steady light; several for one that blinks. */
  dashes: number
  thickness: number
  alpha: AlphaLevel
  /** Unlit: drawn in grey, because nothing red is coming out of the lamp. */
  dark?: boolean
}

/**
 * Every state the light can be in, in the order the board walks through them: standing still,
 * rolling, slowing, stopping hard.
 */
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
  /** What the light is showing right now — the preview if one is held, else the Board's own state. */
  activeMode: BrakeLightMode | null
  /** Set while the rider is holding the light on one state instead of the Board driving it. */
  previewMode: BrakeLightMode | null
  parked: 'off' | 'glow'
  /** Seconds before a held state hands the light back on its own. Null when nothing is held. */
  previewSecondsLeft?: number | null
  /** Inert while the link is down, the light is switched off, or the Board is moving. */
  disabled?: boolean
  /** Hold that state on the light, or hand it back when the same one is tapped again. */
  onPreview: (mode: BrakeLightMode | null) => void
}

/**
 * The light's states as a thing to look at and a thing to press, rather than a line of text.
 *
 * One tile per state, each drawn the way the lamp actually looks in it, with the live one lit. A
 * rider comparing "what is it doing" against "what can it do" reads both off the same four tiles —
 * and tapping one holds the light there long enough to walk behind the board and check, which is
 * the only way to verify a light the protocol never reports back.
 */
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

/**
 * The light itself, drawn as what it puts out: one bar for a steady lamp, broken dashes for one
 * that blinks, thicker and brighter the harder it burns.
 *
 * Deliberately still. An animated lamp says "something is happening now", which is a lie on three
 * of these four tiles — they are the states the light *can* be in, and only one of them is live.
 */
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
  // A short rule, not a bar across the tile: the design language keeps accent colour to thin
  // lines and icons, and a full-width red plane is exactly the fill it rules out.
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
