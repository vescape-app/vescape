import { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Switch } from '@/components/controls/Switch'
import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { theme, type ThemeColor } from '@/constants/theme'

interface StateSample {
  label: string
  value: boolean | null
  pending?: boolean
  disabled?: boolean
}

const STATES: StateSample[] = [
  { label: 'off', value: false },
  { label: 'on', value: true },
  { label: 'unknown', value: null },
  { label: 'pending', value: false, pending: true },
  { label: 'disabled off', value: false, disabled: true },
  { label: 'disabled on', value: true, disabled: true },
  { label: 'disabled unknown', value: null, disabled: true },
]

const ACCENTS: { label: string; accent: ThemeColor }[] = [
  { label: 'sky', accent: theme.palette.sky.color },
  { label: 'green', accent: theme.palette.green.color },
  { label: 'amber', accent: theme.palette.amber.color },
  { label: 'red', accent: theme.palette.red.color },
  { label: 'violet', accent: theme.palette.violet.color },
  { label: 'teal', accent: theme.palette.teal.color },
  { label: 'pink', accent: theme.palette.pink.color },
]

/** A switch whose owner takes a beat to confirm, so the pending state is reachable by tapping. */
function useSlowSwitch(initial: boolean | null) {
  const [value, setValue] = useState<boolean | null>(initial)
  const [pending, setPending] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const onValueChange = useCallback((next: boolean) => {
    setPending(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setValue(next)
      setPending(false)
    }, 800)
  }, [])

  return { value, pending, onValueChange }
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.cell}>
      {children}
      <Text style={styles.cellLabel}>{label}</Text>
    </View>
  )
}

function AccentSample({ label, accent }: { label: string; accent: ThemeColor }) {
  const [value, setValue] = useState(true)
  return (
    <Cell label={label}>
      <Switch value={value} onValueChange={setValue} accent={accent} accessibilityLabel={label} />
    </Cell>
  )
}

export function SwitchShowcase() {
  const [local, setLocal] = useState(true)
  const board = useSlowSwitch(true)
  const unknown = useSlowSwitch(null)

  return (
    <ShowcaseCard name="Switch">
      <Text style={styles.note}>
        Tap or drag. Three rest positions — off, on, and centre for &quot;not known yet&quot;; a
        write in flight spins at centre.
      </Text>

      <Text style={styles.group}>Live</Text>
      <View style={styles.row}>
        <Cell label="local write">
          <Switch value={local} onValueChange={setLocal} accessibilityLabel="Local write" />
        </Cell>
        <Cell label="board write (800ms)">
          <Switch {...board} accent={theme.palette.amber.color} accessibilityLabel="Board write" />
        </Cell>
        <Cell label="board silent until tapped">
          <Switch {...unknown} accent={theme.palette.red.color} accessibilityLabel="Legal mode" />
        </Cell>
      </View>

      <Text style={styles.group}>Every state</Text>
      <View style={styles.row}>
        {STATES.map((state) => (
          <Cell key={state.label} label={state.label}>
            <Switch
              value={state.value}
              onValueChange={() => {}}
              accent={theme.palette.violet.color}
              {...(state.pending ? { pending: true } : {})}
              {...(state.disabled ? { disabled: true } : {})}
              accessibilityLabel={state.label}
            />
          </Cell>
        ))}
      </View>

      <Text style={styles.group}>Accents</Text>
      <View style={styles.row}>
        {ACCENTS.map((sample) => (
          <AccentSample key={sample.label} {...sample} />
        ))}
      </View>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  note: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  group: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
  cell: {
    alignItems: 'center',
    minWidth: 78,
  },
  cellLabel: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    textAlign: 'center',
  },
})
