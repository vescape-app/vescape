import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { BoardPhase } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ToggleRow } from '@/components/dev/ShowcaseControls'
import { BoardPill } from '@/modules/board/components/BoardPill'
import { theme } from '@/constants/theme'

const CONNECTION_STATES: BoardPhase[] = [
  'idle',
  'connecting',
  'discovering',
  'subscribing',
  'waiting_for_telemetry',
  'connected',
  'stale',
  'reconnecting',
  'rescanning',
  'disconnecting',
  'error',
]

export function BoardPillShowcase() {
  const [selected, setSelected] = useState(true)
  const [status, setStatus] = useState<BoardPhase>('connected')
  const [editable, setEditable] = useState(true)
  const [warnings, setWarnings] = useState(false)
  const [critical, setCritical] = useState(false)
  const [faults, setFaults] = useState(false)
  const [recording, setRecording] = useState(false)
  const [replay, setReplay] = useState(false)
  const [longName, setLongName] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [width, setWidth] = useState(300)
  const [lastAction, setLastAction] = useState('Tap any pill button to see its action here.')

  return (
    <ShowcaseCard
      name="BoardPill"
      controls={
        <>
          <ToggleRow label="board selected" value={selected} onToggle={setSelected} />
          {CONNECTION_STATES.map((state) => (
            <ToggleRow
              key={state}
              label={state.replaceAll('_', ' ')}
              value={status === state}
              onToggle={(on) => setStatus(on ? state : 'idle')}
            />
          ))}
          <ToggleRow label="edit enabled" value={editable} onToggle={setEditable} />
          <ToggleRow
            label="board warning"
            value={warnings}
            onToggle={(on) => {
              setWarnings(on)
              if (!on) setCritical(false)
            }}
          />
          <ToggleRow
            label="critical warning"
            value={critical}
            onToggle={(on) => {
              setCritical(on)
              if (on) setWarnings(true)
            }}
          />
          <ToggleRow label="VESC fault" value={faults} onToggle={setFaults} />
          <ToggleRow label="debug recording" value={recording} onToggle={setRecording} />
          <ToggleRow label="replay" value={replay} onToggle={setReplay} />
          <ToggleRow label="long board name" value={longName} onToggle={setLongName} />
          <ToggleRow label="narrow layout" value={narrow} onToggle={setNarrow} />
        </>
      }
    >
      <View style={styles.preview} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <BoardPill
          maxWidth={Math.min(width, narrow ? 250 : width)}
          name={
            selected
              ? longName
                ? 'Funwheel with a very long custom board name'
                : 'Funwheel'
              : null
          }
          bleStatus={status}
          replay={replay}
          onOpenSelector={() => setLastAction('Open board selector')}
          onEdit={selected && editable ? () => setLastAction('Edit board') : undefined}
          onDisconnect={() => {
            setStatus('idle')
            setLastAction('Board disconnected')
          }}
          onStopRecording={
            recording
              ? () => {
                  setRecording(false)
                  setLastAction('Debug recording stopped')
                }
              : undefined
          }
          warning={
            warnings
              ? {
                  severity: critical ? 'critical' : 'warn',
                  onPress: () => setLastAction('Open Board Warnings'),
                }
              : undefined
          }
          fault={faults ? { onPress: () => setLastAction('Open VESC faults') } : undefined}
        />
        <Text style={styles.caption}>
          {status.replaceAll('_', ' ')} · {lastAction}
        </Text>
      </View>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  preview: { alignItems: 'flex-start', gap: 12 },
  caption: { color: theme.neutral.textMuted, fontSize: 12 },
})
