import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ToggleRow } from '@/components/dev/ShowcaseControls'
import { BoardSelectorContent } from '@/modules/board/components/BoardSelectorSheet'
import {
  AccessorySelectorSection,
  type AccessorySelectorItem,
} from '@/modules/accessories/components/AccessorySelectorSection'
import type { Board } from '@/modules/board/store/boardStore'
import { theme } from '@/constants/theme'

const HOUR = 3_600_000

function board(id: string, name: string, extra: Partial<Board> = {}): Board {
  return {
    id,
    name,
    description: null,
    createdAt: 0,
    deletedAt: null,
    batteryConfig: null,
    link: { linkVersion: 4, bleId: `ble-${id}`, transport: 'direct' },
    lastBattery: { percent: 74, voltage: 58.2, at: Date.now() - 3 * 24 * HOUR },
    ...extra,
  }
}

const ACTIVE = board('active', 'Thor301', {
  lastBattery: { percent: 74, voltage: 58.2, at: Date.now() - 2 * HOUR },
})
const LONG_NAME = board('active', 'Smoke Board With A Very Long Name That Keeps Going')
const UNLINKED_ACTIVE = board('active', 'GTR Beast', { link: null, lastBattery: null })
const NEVER_SEEN = board('active', 'Fresh Build', { lastBattery: null })

const OTHERS = [
  board('other-1', 'Smoke Board', {
    lastBattery: { percent: 38, voltage: 51.4, at: Date.now() - 3 * 24 * HOUR },
  }),
  board('other-2', 'GTR Beast', { link: null, lastBattery: null }),
  board('other-3', 'Loaner', {
    lastBattery: { percent: 12, voltage: 47.1, at: Date.now() - HOUR },
  }),
]

/** Accessories are listed flat beside the Boards: they target whichever Board is connected. */
const ACCESSORIES: AccessorySelectorItem[] = [
  {
    accessoryId: 'clearance-1',
    name: 'Clearance sensor',
    detail: 'v0.1.0',
    status: 'advertising',
  },
  { accessoryId: 'light-1', name: 'Rear light', detail: 'v0.2.1', status: 'idle' },
  {
    accessoryId: 'horn-1',
    name: 'Air horn',
    detail: 'v1.0.0',
    status: 'unreachable',
    incompatible: true,
  },
]

export function BoardSelectorSheetShowcase() {
  const [live, setLive] = useState(true)
  const [warningsOn, setWarningsOn] = useState(true)
  const [warningCount, setWarningCount] = useState(2)
  const [critical, setCritical] = useState(false)
  const [faultsOn, setFaultsOn] = useState(true)
  const [faultCount, setFaultCount] = useState(1)
  const [longName, setLongName] = useState(false)
  const [unlinked, setUnlinked] = useState(false)
  const [neverSeen, setNeverSeen] = useState(false)
  const [alone, setAlone] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [accessoriesOn, setAccessoriesOn] = useState(true)
  const [noAccessories, setNoAccessories] = useState(false)
  const [lastAction, setLastAction] = useState('Tap a row or link to see its action here.')

  const active = unlinked ? UNLINKED_ACTIVE : neverSeen ? NEVER_SEEN : longName ? LONG_NAME : ACTIVE
  const boards = empty ? [] : alone ? [active] : [active, ...OTHERS]

  return (
    <ShowcaseCard
      name="BoardSelectorSheet"
      controls={
        <>
          <ToggleRow label="connected (pull rate)" value={live} onToggle={setLive} />
          <ToggleRow label="warnings enabled" value={warningsOn} onToggle={setWarningsOn} />
          <ToggleRow
            label="warnings pending"
            value={warningCount > 0}
            onToggle={(on) => setWarningCount(on ? 2 : 0)}
          />
          <ToggleRow label="critical warning" value={critical} onToggle={setCritical} />
          <ToggleRow label="faults enabled" value={faultsOn} onToggle={setFaultsOn} />
          <ToggleRow
            label="faults pending"
            value={faultCount > 0}
            onToggle={(on) => setFaultCount(on ? 1 : 0)}
          />
          <ToggleRow label="long board name" value={longName} onToggle={setLongName} />
          <ToggleRow label="active board unlinked" value={unlinked} onToggle={setUnlinked} />
          <ToggleRow label="active board never seen" value={neverSeen} onToggle={setNeverSeen} />
          <ToggleRow label="only one board" value={alone} onToggle={setAlone} />
          <ToggleRow label="no boards yet" value={empty} onToggle={setEmpty} />
          <ToggleRow
            label="accessories section"
            value={accessoriesOn}
            onToggle={setAccessoriesOn}
          />
          <ToggleRow label="no accessories yet" value={noAccessories} onToggle={setNoAccessories} />
        </>
      }
    >
      <View style={styles.sheet}>
        <BoardSelectorContent
          boards={boards}
          accessories={
            accessoriesOn ? (
              <AccessorySelectorSection
                accessories={noAccessories ? [] : ACCESSORIES}
                onSelectAccessory={(id) => setLastAction(`Open accessory ${id}`)}
                onAddAccessory={() => setLastAction('Add accessory')}
              />
            ) : undefined
          }
          activeBoardId={active.id}
          activeBoardLive={live}
          warnings={
            warningsOn
              ? {
                  count: warningCount,
                  severity: critical ? 'critical' : 'warn',
                  onPress: () => setLastAction('Open warnings'),
                }
              : undefined
          }
          faults={
            faultsOn
              ? { count: faultCount, onPress: () => setLastAction('Open VESC faults') }
              : undefined
          }
          onSelectBoard={(id) => setLastAction(`Select board ${id}`)}
          onAddBoard={() => setLastAction('Add new board')}
          onEditBoard={(id) => setLastAction(`Edit board ${id}`)}
        />
      </View>
      <Text style={styles.action}>{lastAction}</Text>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  // The drawer the real selector lives in: full width, so the active card's extra width over the
  // list column reads the same here as on the map.
  sheet: {
    alignSelf: 'stretch',
    padding: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.alpha(theme.neutral.bg, 0.85),
    overflow: 'hidden',
  },
  action: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    paddingTop: 8,
  },
})
