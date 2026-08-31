import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { setBoardLights } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

/**
 * Naive Refloat lights switch. Sends `LIGHTS_CONTROL` and shows whether native accepted the write —
 * `false` means no trusted Board Link, not that the board refused. The board's own answer is its
 * echo frame, which native logs.
 */
export function BoardLightsProbe() {
  const [lastResult, setLastResult] = useState<string | null>(null)

  const send = useCallback((enabled: boolean) => {
    void setBoardLights(enabled).then((sent) => {
      setLastResult(`${enabled ? 'on' : 'off'} → ${sent ? 'sent' : 'refused (no trusted link)'}`)
    })
  }, [])

  return (
    <>
      <Text style={styles.sectionTitle}>Board lights</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Runtime Refloat `LIGHTS_CONTROL`: switches LEDs and headlights together, stores nothing.
          Boards without LEDs ignore it.
        </Text>
        <View style={styles.buttonRow}>
          <Pressable style={styles.button} onPress={() => send(true)}>
            <Text style={styles.buttonText}>Lights on</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => send(false)}>
            <Text style={styles.buttonText}>Lights off</Text>
          </Pressable>
        </View>
        <Text style={styles.result}>{lastResult ?? 'No command sent yet'}</Text>
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
  card: {
    backgroundColor: theme.neutral.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    overflow: 'hidden',
    padding: 14,
  },
  hint: {
    color: theme.neutral.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: theme.neutral.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 8,
    paddingVertical: 12,
  },
  buttonText: {
    color: theme.neutral.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  result: {
    color: theme.neutral.textDim,
    fontSize: 11,
    marginTop: 10,
  },
})
