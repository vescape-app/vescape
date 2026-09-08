import React from 'react'
import { Box, Text } from 'ink'
import { Hint, Menu, Rule } from '../ui'
import type { DashboardAction } from './actions'
import type { ReleaseState, TrackRow } from './state'

const column = (value: string, width: number) => value.padEnd(width)

function TrackLine({ name, row }: { name: string; row: TrackRow | null }) {
  if (!row) {
    return (
      <Text dimColor>
        {column(name, 18)}
        {column('—', 12)}—
      </Text>
    )
  }
  return (
    <Text>
      {column(name, 18)}
      <Text bold>{column(row.marketingVersion, 12)}</Text>
      <Text dimColor>{row.age ?? '—'}</Text>
    </Text>
  )
}

export function Dashboard({
  state,
  actions,
  index,
}: {
  state: ReleaseState
  actions: readonly DashboardAction[]
  index: number
}) {
  return (
    <Box flexDirection="column">
      <Rule />
      <Text dimColor>
        {column('TRACK', 18)}
        {column('VERSION', 12)}
        UPDATED
      </Text>
      <TrackLine name="Internal" row={state.internal} />
      <TrackLine name="Open testing" row={state.open} />
      <TrackLine name="Production" row={state.production} />
      <Rule />
      {state.guidance ? <Text color="yellow">{state.guidance}</Text> : null}
      {state.alerts.map((alert) => (
        <Text key={alert} color="yellow">
          {column('Problem', 18)}
          {alert}
        </Text>
      ))}
      {state.error ? (
        <Text color="red">{state.error}</Text>
      ) : (
        <Hint>
          {state.loading ? 'Loading…' : 'Last known from workflow manifests, not live Play state'}
        </Hint>
      )}
      <Rule />
      <Box flexDirection="column" marginTop={1}>
        <Text bold>What would you like to do?</Text>
        <Menu
          items={actions.map((action) => ({ key: action.id, label: action.label }))}
          index={index}
        />
        <Hint>↑/↓ · Enter · Esc quits</Hint>
      </Box>
    </Box>
  )
}
