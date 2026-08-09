import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  ArrowRightIcon,
  BluetoothIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  DeviceMobileIcon,
  LockIcon,
  WifiHighIcon,
  WifiLowIcon,
  WifiSlashIcon,
} from 'phosphor-react-native'
import { addOwStateListener, owConnect, owDisconnect, type OwStateEvent } from 'vescape-core'
import { useShallow } from 'zustand/react/shallow'

import { Button } from '@/components/base/Button'
import { DeviceRow } from '@/components/base/DeviceRow'
import { theme } from '@/constants/theme'
import { BoardLinkTimeline } from '@/modules/board/components/BoardLinkTimeline'
import type { UseAddBoardWizard } from '@/modules/board/hooks/useAddBoardWizard'
import { useBoardLink } from '@/modules/board/hooks/useBoardLink'
import { formatBmsSuffix, formatBoardTransport } from '@/modules/board/lib/boardTransport'
import { isOneWheelDevice } from '@/modules/board/lib/onewheel'
import { NUS_SERVICE_UUID, useBleStore } from '@/modules/board/store/bleStore'
import { usePermissions } from '@/modules/settings/hooks/usePermissions'

interface Props {
  wizard: UseAddBoardWizard
  onLinkActiveStepIndexChange?: (index: number) => void
  scrollRef?: RefObject<ScrollView | null>
}

export function ScanStep({ wizard, onLinkActiveStepIndexChange, scrollRef }: Props) {
  if (wizard.pairPhase === 'onewheel') {
    return <OneWheelPairStep wizard={wizard} />
  }
  if (wizard.pairPhase === 'probing') {
    return (
      <LinkStep
        wizard={wizard}
        scrollRef={scrollRef}
        onLinkActiveStepIndexChange={onLinkActiveStepIndexChange}
      />
    )
  }
  return <ScanSelectStep wizard={wizard} />
}

function LinkStep({ wizard, onLinkActiveStepIndexChange, scrollRef }: Props) {
  const link = useBoardLink(wizard.bleId || null)

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.step}
      keyboardShouldPersistTaps="handled"
    >
      <BoardLinkTimeline
        phase={link.phase}
        progress={link.progress}
        candidates={link.candidates}
        selected={link.selected}
        onSelect={link.select}
        deviceLabel={wizard.bleName || wizard.bleId}
        bleId={wizard.bleId}
        testIDPrefix="add-board-link"
        onActiveStepIndexChange={onLinkActiveStepIndexChange}
        actions={
          link.phase === 'picking' ? (
            <Button
              style={styles.upgradeButton}
              label="Save link"
              icon={CheckCircleIcon}
              disabled={link.selectedLink == null}
              onPress={() => {
                if (link.selectedLink) wizard.onDeviceProbed(link.selectedLink)
              }}
              testID="add-board-link-save"
            />
          ) : link.phase === 'failed' ? (
            <>
              <Button
                style={styles.upgradeButton}
                label="Retry"
                icon={WifiHighIcon}
                onPress={link.retry}
                testID="add-board-link-retry"
              />
              <Button
                label="Choose another device"
                variant="secondary"
                icon={BluetoothIcon}
                onPress={wizard.clearDevice}
                testID="add-board-link-choose-another"
              />
              <Button
                label="Create offline"
                variant="secondary"
                onPress={wizard.continueOffline}
                testID="add-board-link-offline"
              />
            </>
          ) : null
        }
      />
    </ScrollView>
  )
}

function ScanSelectStep({ wizard }: { wizard: UseAddBoardWizard }) {
  const { status, request } = usePermissions()
  const { devices, error, startScan, stopScan, isScanning } = useBleStore(
    useShallow((state) => ({
      devices: state.devices,
      error: state.error,
      startScan: state.startScan,
      stopScan: state.stopScan,
      isScanning: state.scanStatus === 'scanning',
    })),
  )
  const [showOther, setShowOther] = useState(false)

  useEffect(() => {
    void request()
  }, [request])

  useEffect(() => {
    if (status === 'granted') startScan()
    return () => stopScan()
  }, [status, startScan, stopScan])

  const { vescDevices, owDevices, otherDevices } = useMemo(() => {
    const vesc = []
    const ow = []
    const other = []
    for (const device of devices) {
      if (device.serviceUUIDs.some((uuid) => uuid.toLowerCase() === NUS_SERVICE_UUID)) {
        vesc.push(device)
      } else if (isOneWheelDevice(device)) {
        ow.push(device)
      } else {
        other.push(device)
      }
    }
    return { vescDevices: vesc, owDevices: ow, otherDevices: other }
  }, [devices])

  const SignalIcon = isScanning ? WifiHighIcon : devices.length > 0 ? WifiLowIcon : WifiSlashIcon

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.step}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <BluetoothIcon size={20} color={theme.palette.sky.color} weight="duotone" />
        <Text style={styles.title}>Pair your board</Text>
        <View style={styles.headerSpacer} />
        {wizard.draftLink ? (
          <Button
            label="Next"
            variant="accent"
            size="sm"
            icon={ArrowRightIcon}
            iconPosition="right"
            onPress={wizard.next}
            testID="add-board-pair-next"
            style={styles.headerActionButton}
          />
        ) : (
          <Button
            label="Skip"
            variant="accent"
            size="sm"
            icon={ArrowRightIcon}
            iconPosition="right"
            onPress={wizard.continueOffline}
            testID="add-board-skip-pairing"
            style={styles.headerActionButton}
          />
        )}
      </View>

      {wizard.draftLink ? (
        <>
          <View style={styles.pairedBanner}>
            <BluetoothIcon size={16} color={theme.palette.green.color} weight="duotone" />
            <Text style={styles.pairedText}>
              Linked to {wizard.bleName || wizard.bleId} ·{' '}
              {formatBoardTransport(wizard.draftLink.transport)}
              {formatBmsSuffix(wizard.draftLink.hasBms)}
            </Text>
          </View>
          <Button
            label="Change device"
            variant="secondary"
            icon={BluetoothIcon}
            onPress={wizard.clearDevice}
          />
        </>
      ) : (
        <>
          <View style={styles.scanHeader}>
            {isScanning && <ActivityIndicator color={theme.palette.sky.color} size="small" />}
            <SignalIcon
              size={14}
              color={isScanning ? theme.palette.sky.color : theme.palette.slate.textMuted}
              weight="bold"
            />
            <Text style={styles.scanStatus}>
              {status === 'denied'
                ? 'Bluetooth permission required'
                : error
                  ? error
                  : isScanning
                    ? 'Scanning for nearby boards…'
                    : 'No boards found'}
            </Text>
          </View>
          {vescDevices.map((device) => (
            <DeviceRow
              key={device.id}
              id={device.id}
              name={device.name}
              rssi={device.rssi}
              onPress={() => wizard.selectDevice(device.id, device.name)}
            />
          ))}
          {owDevices.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>OneWheel (PoC)</Text>
              {owDevices.map((device) => (
                <DeviceRow
                  key={device.id}
                  id={device.id}
                  name={device.name}
                  rssi={device.rssi}
                  onPress={() => {
                    stopScan()
                    wizard.selectOneWheel(device.id, device.name)
                  }}
                />
              ))}
            </>
          )}
          {vescDevices.length === 0 && devices.length === 0 && isScanning && (
            <Text style={styles.emptyHint}>Boards will appear as they are found</Text>
          )}
          {otherDevices.length > 0 && (
            <>
              <Pressable
                style={styles.otherDevicesToggle}
                onPress={() => setShowOther((visible) => !visible)}
                hitSlop={8}
              >
                {showOther ? (
                  <CaretDownIcon size={12} color={theme.palette.slate.textMuted} weight="bold" />
                ) : (
                  <CaretRightIcon size={12} color={theme.palette.slate.textMuted} weight="bold" />
                )}
                <Text style={styles.otherDevicesLabel}>Other devices ({otherDevices.length})</Text>
              </Pressable>
              {showOther &&
                otherDevices.map((device) => (
                  <DeviceRow
                    key={device.id}
                    id={device.id}
                    name={device.name}
                    rssi={device.rssi}
                    onPress={() => wizard.selectDevice(device.id, device.name)}
                  />
                ))}
            </>
          )}
        </>
      )}
    </ScrollView>
  )
}

function OneWheelPairStep({ wizard }: { wizard: UseAddBoardWizard }) {
  const [connecting, setConnecting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const wizardRef = useRef(wizard)
  wizardRef.current = wizard

  useEffect(() => {
    if (!connecting) return
    let completed = false
    const subscription = addOwStateListener((state: OwStateEvent) => {
      if (state.phase === 'ready') {
        completed = true
        owDisconnect()
        wizardRef.current.onOneWheelReady()
      } else if (state.phase === 'locked' || state.phase === 'error') {
        completed = true
        owDisconnect()
        setConnecting(false)
        setFailure(
          state.message ?? 'Open the Onewheel app, connect to the board, then return and retry.',
        )
      }
    })
    owConnect(wizardRef.current.bleId)
    return () => {
      subscription.remove()
      if (!completed) owDisconnect()
    }
  }, [connecting])

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.step}>
      <View style={styles.header}>
        <DeviceMobileIcon size={20} color={theme.palette.sky.color} weight="duotone" />
        <Text style={styles.title}>Prepare your OneWheel</Text>
      </View>

      <View style={styles.owNotice}>
        <Text style={styles.owNoticeTitle}>The official app must unlock the board first</Text>
        <Text style={styles.owNoticeText}>
          1. Open the Onewheel app and connect to {wizard.bleName || 'the board'}.{`\n`}2. Wait
          until its riding mode and battery appear.{`\n`}3. Return here and tap Connect.
        </Text>
      </View>

      {failure ? (
        <View style={styles.owFailure}>
          <LockIcon size={18} color={theme.status.error.color} weight="duotone" />
          <Text style={styles.owFailureText} selectable>
            {failure}
          </Text>
        </View>
      ) : null}

      <Button
        label={connecting ? 'Connecting…' : failure ? 'Try again' : 'Connect in Vescape'}
        icon={BluetoothIcon}
        disabled={connecting}
        onPress={() => {
          setFailure(null)
          setConnecting(true)
        }}
        testID="add-board-onewheel-connect"
      />
      <Button
        label="Choose another board"
        variant="secondary"
        disabled={connecting}
        onPress={wizard.clearDevice}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  step: {
    flexGrow: 1,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerSpacer: {
    flex: 1,
  },
  title: {
    color: theme.palette.slate.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  headerActionButton: {
    height: 28,
    paddingHorizontal: 10,
  },
  scanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scanStatus: {
    color: theme.palette.slate.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  emptyHint: {
    color: theme.palette.slate.textDim,
    textAlign: 'center',
    marginTop: 32,
    fontSize: 13,
  },
  otherDevicesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  otherDevicesLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  sectionLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  pairedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.palette.green.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.palette.green.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  pairedText: {
    color: theme.palette.green.text,
    fontSize: 14,
    fontWeight: '600',
  },
  upgradeButton: {
    backgroundColor: theme.status.upgrade.color,
  },
  owNotice: {
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.status.info.border,
    backgroundColor: theme.status.info.bg,
  },
  owNoticeTitle: {
    color: theme.status.info.text,
    fontSize: 15,
    fontWeight: '700',
  },
  owNoticeText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  owFailure: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.status.error.border,
    backgroundColor: theme.status.error.bg,
  },
  owFailureText: {
    flex: 1,
    color: theme.status.error.text,
    fontSize: 13,
    lineHeight: 19,
  },
})
