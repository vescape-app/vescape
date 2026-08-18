import { useEffect, useMemo, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  BatteryChargingIcon,
  BluetoothIcon,
  CheckIcon,
  CpuIcon,
  HandshakeIcon,
  type Icon,
  LightningIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  PathIcon,
  WarningCircleIcon,
} from 'phosphor-react-native'
import type { BoardCandidate, BoardProbeProgressEvent, BoardProbeStep } from 'vescape-core'

import { IconHero } from '@/components/settings/IconHero'
import { StepTimeline, type StepState, type TimelineStep } from '@/components/base/StepTimeline'
import type { BoardLinkPhase } from '@/modules/board/hooks/useBoardLink'
import {
  formatBoardTransport,
  formatCandidateTransport,
  formatRefloatIdentity,
} from '@/modules/board/lib/boardTransport'
import { interaction, theme } from '@/constants/theme'

/**
 * One row per real probe activity, in the order the probe performs them:
 * open GATT → discover the VESC service → ping the CAN bus → prove a transport
 * with a telemetry request → wait for a BMS answer → read the Refloat identity.
 */
type StepKey = 'connect' | 'handshake' | 'scan' | 'transport' | 'bms' | 'identity'

const STEP_KEYS: StepKey[] = ['connect', 'handshake', 'scan', 'transport', 'bms', 'identity']

const STEP_LABEL: Record<StepKey, string> = {
  connect: 'Connecting',
  handshake: 'Handshake',
  scan: 'CAN scan',
  transport: 'Transport',
  bms: 'Smart BMS',
  identity: 'Firmware',
}

const STEP_ICON: Record<StepKey, Icon> = {
  connect: BluetoothIcon,
  handshake: HandshakeIcon,
  scan: MagnifyingGlassIcon,
  transport: PathIcon,
  bms: BatteryChargingIcon,
  identity: CpuIcon,
}

/** What each step does — shown until a concrete result replaces it. */
const STEP_DESC: Record<StepKey, string> = {
  connect: 'Opening the BLE GATT link',
  handshake: 'Discovering the VESC service',
  scan: 'Pinging the CAN bus',
  transport: 'Waiting for telemetry proof',
  bms: 'Waiting for a BMS answer',
  identity: 'Reading firmware versions',
}

/**
 * Index of the live step driving the spinner. Every native milestone maps onto
 * one row; a milestone whose reply never comes is skipped — the probe window
 * closing (`completed`) resolves the remaining rows from the candidates.
 */
const STEP_REACH: Record<BoardProbeStep, number> = {
  connecting: 0,
  handshake: 1,
  pinging: 2,
  probing: 3,
  bms: 4,
  identity: 5,
  completed: STEP_KEYS.length,
  failed: -1,
}

interface Props {
  phase: BoardLinkPhase
  progress: BoardProbeProgressEvent | null
  candidates: BoardCandidate[]
  selected: BoardCandidate | null
  onSelect: (candidate: BoardCandidate) => void
  /** Primary identity of the thing being linked (board name, or BLE name). */
  deviceLabel: string
  /** Hide the internal IconHero header (caller renders it elsewhere, e.g. pinned top). */
  hideHeader?: boolean
  /** Peripheral id, surfaced as the "Connected to …" finding. */
  bleId?: string | null
  /** Terminal actions (Save / Retry / Choose another), rendered after the timeline. */
  actions?: ReactNode
  /** Muted note under a failed terminal, e.g. "Existing link kept". */
  failureNote?: string
  /** Active row index while probing; -1 when terminal, so parent scroll can reset. */
  onActiveStepIndexChange?: (index: number) => void
  testIDPrefix: string
}

/**
 * One fixed linking checklist that fills in as the Board Probe advances. Each
 * row resolves in probe order and its caption is written once — later facts
 * land in later rows instead of rewriting earlier ones. When several transports
 * answer, the picker renders inline inside the Transport step and the BMS and
 * Identity rows follow the selected candidate.
 */
export function BoardLinkTimeline({
  phase,
  progress,
  candidates,
  selected,
  onSelect,
  deviceLabel,
  hideHeader,
  bleId,
  actions,
  failureNote,
  onActiveStepIndexChange,
  testIDPrefix,
}: Props) {
  const steps = buildSteps(phase, progress, candidates, bleId, {
    selected,
    onSelect,
    testIDPrefix,
  })
  const activeIndex = useMemo(() => steps.findIndex((step) => step.state === 'active'), [steps])

  useEffect(() => {
    onActiveStepIndexChange?.(activeIndex)
  }, [activeIndex, onActiveStepIndexChange])

  return (
    <View style={styles.container} testID={testIDPrefix}>
      {hideHeader ? null : (
        <IconHero
          icon={LinkIcon}
          title={deviceLabel}
          description="Linking your board over Bluetooth"
        />
      )}

      <StepTimeline steps={steps} />

      {phase === 'failed' && failureNote ? (
        <Text style={styles.failureNote}>{failureNote}</Text>
      ) : null}

      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  )
}

interface PickerHandles {
  selected: BoardCandidate | null
  onSelect: (candidate: BoardCandidate) => void
  testIDPrefix: string
}

/** Resolve the fixed checklist rows for the current phase. */
function pickingSteps(
  progress: BoardProbeProgressEvent | null,
  candidates: BoardCandidate[],
  connected: string,
  picker: PickerHandles,
): TimelineStep[] {
  const single = candidates.length === 1 ? candidates[0] : null
  // The BMS and Identity rows describe one candidate: the only one, or the pick.
  const resolved = single ?? picker.selected ?? candidates[0] ?? null
  const canIds =
    progress?.canIds ??
    candidates.map((c) => c.transport).filter((t): t is number => typeof t === 'number')
  return [
    row('connect', 'done', connected),
    row('handshake', 'done', 'VESC service ready'),
    row('scan', 'done', canScanCaption(canIds)),
    single
      ? row('transport', 'done', formatBoardTransport(single.transport))
      : {
          ...row('transport', 'done', 'Several transports answered — pick one'),
          content: <TransportPicker candidates={candidates} picker={picker} />,
        },
    resolved?.hasBms
      ? row('bms', 'done', 'Smart BMS answered')
      : row('bms', 'absent', 'No smart BMS'),
    identityRow(resolved),
  ]
}

function failedSteps(
  progress: BoardProbeProgressEvent | null,
  connected: string,
  reach: number,
): TimelineStep[] {
  const didConnect = reach >= 1
  const didHandshake = reach >= 2
  const didScan = reach >= 3
  return [
    row(
      'connect',
      didConnect ? 'done' : 'failed',
      didConnect ? connected : 'Could not open BLE connection',
    ),
    row(
      'handshake',
      didHandshake ? 'done' : didConnect ? 'failed' : 'pending',
      didHandshake
        ? 'VESC service ready'
        : didConnect
          ? 'VESC service not ready'
          : STEP_DESC.handshake,
    ),
    row(
      'scan',
      didScan ? 'done' : 'pending',
      didScan ? canScanCaption(progress?.canIds) : STEP_DESC.scan,
    ),
    row(
      'transport',
      didScan ? 'failed' : 'pending',
      didScan ? 'No transport returned telemetry' : STEP_DESC.transport,
    ),
    row('bms', 'absent', 'No BMS answer'),
    row('identity', 'absent', 'No firmware info'),
  ]
}

/**
 * Live linking: the spinner walks the rows in probe order, each upgrading to its result the moment
 * the probe reports it. A caption is written once and never rewritten — facts that arrive later
 * land in later rows.
 */
function liveSteps(
  progress: BoardProbeProgressEvent | null,
  connected: string,
  reach: number,
): TimelineStep[] {
  const transportLabel =
    progress?.transport != null ? formatBoardTransport(progress.transport) : null
  const liveDone: Partial<Record<StepKey, string>> = {
    connect: connected,
    handshake: 'VESC service ready',
    scan: canScanCaption(progress?.canIds),
    transport: transportLabel ?? 'Transport confirmed',
    bms: 'Smart BMS answered',
  }
  const liveActive: Partial<Record<StepKey, string>> = {
    transport: transportLabel ? `Trying ${transportLabel}…` : undefined,
  }
  return STEP_KEYS.map((key, i): TimelineStep => {
    const state: StepState = i < reach ? 'done' : i === reach ? 'active' : 'pending'
    const caption =
      (state === 'done' && liveDone[key]) ||
      (state === 'active' && liveActive[key]) ||
      STEP_DESC[key]
    return { key, icon: STEP_ICON[key], label: STEP_LABEL[key], state, caption }
  })
}

function buildSteps(
  phase: BoardLinkPhase,
  progress: BoardProbeProgressEvent | null,
  candidates: BoardCandidate[],
  bleId: string | null | undefined,
  picker: PickerHandles,
): TimelineStep[] {
  const reach = progress ? STEP_REACH[progress.step] : 0
  const connected = `Connected to ${bleId ?? '…'}`

  if (phase === 'picking') return pickingSteps(progress, candidates, connected, picker)
  if (phase === 'failed') return failedSteps(progress, connected, reach)
  return liveSteps(progress, connected, reach)
}

function row(key: StepKey, state: StepState, caption: string): TimelineStep {
  return { key, icon: STEP_ICON[key], label: STEP_LABEL[key], state, caption }
}

function canScanCaption(canIds: number[] | undefined): string {
  if (!canIds || canIds.length === 0) return 'No CAN devices answered'
  const label = canIds.length === 1 ? 'CAN id' : 'CAN ids'
  return `${label} ${canIds.join(', ')} answered`
}

/** Refloat identity (plus VESC firmware) of the resolved candidate. */
function identityRow(candidate: BoardCandidate | null): TimelineStep {
  const identity = candidate ? formatRefloatIdentity(candidate) : null
  // vescFirmwareVersion is already self-labeled, e.g. "FW 6.05 · ADV500".
  const caption = [identity, candidate?.vescFirmwareVersion].filter(Boolean).join(' · ')
  if (identity) return row('identity', 'done', caption)
  return {
    ...row('identity', 'absent', caption || 'No firmware info'),
    content: <RefloatIdentityWarning />,
  }
}

function TransportPicker({
  candidates,
  picker,
}: {
  candidates: BoardCandidate[]
  picker: PickerHandles
}) {
  return (
    <View style={styles.pickerCard}>
      {candidates.map((candidate, i) => {
        const isSelected = candidate.transport === picker.selected?.transport
        const refloatIdentity = formatRefloatIdentity(candidate)
        return (
          <Pressable
            key={String(candidate.transport)}
            style={[styles.pickerRow, i > 0 && styles.pickerRowDivider]}
            android_ripple={interaction.ripple}
            onPress={() => picker.onSelect(candidate)}
            testID={`${picker.testIDPrefix}-option-${candidate.transport}`}
          >
            <View style={[styles.radio, isSelected && styles.radioOn]}>
              {isSelected ? (
                <CheckIcon size={14} color={theme.palette.sky.color} weight="bold" />
              ) : null}
            </View>
            <View style={styles.pickerText}>
              <Text style={styles.pickerLabel}>
                {formatCandidateTransport(candidate.transport)}
              </Text>
              {refloatIdentity ? (
                <Text style={styles.identityText}>{refloatIdentity}</Text>
              ) : (
                <RefloatIdentityWarning />
              )}
            </View>
            {candidate.hasBms ? <BmsChip /> : null}
          </Pressable>
        )
      })}
    </View>
  )
}

function RefloatIdentityWarning() {
  return (
    <View style={styles.warningRow}>
      <WarningCircleIcon size={13} color={theme.status.warning.color} weight="fill" />
      <Text style={styles.warningText}>Refloat version missing</Text>
    </View>
  )
}

function BmsChip() {
  return (
    <View style={styles.bmsChip}>
      <LightningIcon size={12} color={theme.palette.green.color} weight="duotone" />
      <Text style={styles.bmsChipText}>BMS</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  pickerCard: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickerRowDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.palette.slate.border,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: theme.palette.slate.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    borderColor: theme.palette.sky.color,
  },
  pickerText: {
    flex: 1,
    gap: 2,
  },
  pickerLabel: {
    color: theme.palette.slate.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  identityText: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  warningText: {
    color: theme.status.warning.text,
    fontSize: 12,
    fontWeight: '700',
  },
  bmsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.palette.green.bg,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  bmsChipText: {
    color: theme.palette.green.text,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  failureNote: {
    color: theme.palette.slate.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  actions: {
    gap: 10,
  },
})
