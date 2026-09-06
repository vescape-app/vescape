import React from 'react'
import { Box, Text } from 'ink'
import { Hint, Menu, Rule } from '../ui'
import type { DashboardAction } from './actions'
import type { ReleaseState, TrackRow } from './state'

const column = (value: string, width: number) => value.padEnd(width)

function TrackLine({
  name,
  track,
  row,
  extra,
}: {
  name: string
  track: string | undefined
  row: TrackRow | null
  extra?: string
}) {
  if (!row) {
    return (
      <Text dimColor>
        {column(name, 13)}
        {column('—', 10)}
        {column('', 24)}
        {track ?? ''}
      </Text>
    )
  }
  return (
    <Text>
      {column(name, 13)}
      <Text bold>{column(row.marketingVersion, 10)}</Text>
      {column(`${row.phone} / ${row.wear}`, 24)}
      {row.detail}
      {extra ? <Text color="yellow">{extra}</Text> : null}
      {row.age ? <Text dimColor> · {row.age}</Text> : null}
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
  const { tracks } = state
  return (
    <Box flexDirection="column">
      <Rule />
      <Text>
        {column('dev', 13)}
        <Text bold>{column(state.devVersion ?? '…', 10)}</Text>
        <Text dimColor>{state.notesPath ?? ''}</Text>
      </Text>
      <Rule />
      <Text dimColor>
        {column('TRACK', 13)}
        {column('VERSION', 10)}
        {column('PHONE / WEAR', 24)}
        STATE
      </Text>
      <TrackLine name="internal" track={tracks?.phoneInternal} row={state.internal} />
      <TrackLine name="open" track={tracks?.phoneOpen} row={state.open} />
      <TrackLine name="production" track={tracks?.phoneProduction} row={state.production} />
      <Rule />
      {state.pendingInternal > 0 && (
        <Text>
          {column('pending', 13)}
          {state.pendingInternal} internal build
          {state.pendingInternal === 1 ? '' : 's'} not on open
        </Text>
      )}
      {state.pendingOpen > 0 && (
        <Text>
          {column('pending', 13)}
          {state.pendingOpen} open promotion
          {state.pendingOpen === 1 ? '' : 's'} not on production
        </Text>
      )}
      {state.prereleases.length > 0 && (
        <Text>
          {column('prerelease', 13)}
          {state.prereleases.join(', ')} not on production
        </Text>
      )}
      {state.alerts.map((alert) => (
        <Text key={alert} color="yellow">
          {column('failed', 13)}
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
        <Text bold>Actions</Text>
        <Menu
          items={actions.map((action) => ({ key: action.id, label: action.label }))}
          index={index}
        />
        <Hint>↑/↓ · Enter · Esc quits</Hint>
      </Box>
    </Box>
  )
}
