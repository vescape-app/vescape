import { ScrollView, StyleSheet, Switch } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import {
  BellIcon,
  GaugeIcon,
  GearSixIcon,
  MoonIcon,
  UserIcon,
  WifiHighIcon,
} from 'phosphor-react-native'

import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { Stepper } from '@/components/forms/Stepper'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import { BoardTopSpeedCard } from '@/modules/alerts/components/BoardTopSpeedCard'
import {
  AutoStartCard,
  type AutoStartBoard,
  type AutoStartCardProps,
} from '@/modules/settings/components/AutoStartCard'
import { ConnectionPausedCard } from '@/modules/settings/components/ConnectionPausedCard'
import { ReleaseActionPill } from '@/modules/release/components/ReleaseActionPill'

const MOCK_BOARDS: AutoStartBoard[] = [
  { id: 'showcase-1', name: 'Blue Board', bleId: 'AA:BB:CC:11:22:33' },
  { id: 'showcase-2', name: 'Dirt Bike', bleId: 'AA:BB:CC:44:55:66' },
  { id: 'showcase-3', name: 'Pint X', bleId: 'AA:BB:CC:77:88:99' },
]

/** Drives the showcase AutoStartCard so every state is reachable by tapping. */
function useMockAutoStart(): AutoStartCardProps {
  const [enabled, setEnabled] = useState(true)
  const [armedBoardIds, setArmed] = useState<string[]>([MOCK_BOARDS[0].id])
  return {
    enabled,
    boards: MOCK_BOARDS,
    armedBoardIds,
    onToggle: setEnabled,
    onEnableBoard: (boardId) => setArmed((prev) => [...prev, boardId]),
    onDisableBoard: (boardId) => setArmed((prev) => prev.filter((id) => id !== boardId)),
  }
}

export default function SettingsPage() {
  const [darkMode, setDarkMode] = useState(true)
  const [notifications, setNotifications] = useState(false)
  const [threshold, setThreshold] = useState(3)
  const [boardTopSpeed, setBoardTopSpeed] = useState(50)
  const autoStart = useMockAutoStart()

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ShowcaseCard name="Settings components">
          <IconHero
            icon={GearSixIcon}
            description="IconHero with a large thin icon and centered description."
          >
            <ReleaseActionPill latestVersion="0.81.0" onPress={() => {}} />
            <ReleaseActionPill onPress={() => {}} />
          </IconHero>

          <SettingsSectionTitle>Account</SettingsSectionTitle>
          <SettingsCard>
            <SettingsRow
              icon={UserIcon}
              label="Profile"
              hint="Edit your profile information"
              onPress={() => {}}
            />
            <SettingsRow
              icon={GearSixIcon}
              label="Preferences"
              hint="App settings and defaults"
              onPress={() => {}}
            />
          </SettingsCard>

          <SettingsSectionTitle>Appearance</SettingsSectionTitle>
          <SettingsCard>
            <SettingsRow
              icon={MoonIcon}
              iconWeight="fill"
              label="Dark mode"
              hint="Use dark theme throughout the app"
              right={
                <Switch
                  value={darkMode}
                  onValueChange={setDarkMode}
                  trackColor={{ false: theme.palette.slate.border, true: theme.palette.sky.border }}
                  thumbColor={darkMode ? theme.palette.sky.color : theme.palette.slate.textMuted}
                />
              }
            />
          </SettingsCard>

          <SettingsSectionTitle>Ride stats</SettingsSectionTitle>
          <SettingsCard>
            <SettingsRow
              icon={GaugeIcon}
              label="Moving speed threshold"
              hint="Speeds below this are treated as stopped"
              right={
                <Stepper
                  value={threshold}
                  unit="km/h"
                  min={0}
                  max={20}
                  onChange={(nextValue) => setThreshold(Math.min(20, Math.max(0, nextValue)))}
                />
              }
            />
          </SettingsCard>

          <SettingsSectionTitle>Notifications</SettingsSectionTitle>
          <SettingsCard>
            <SettingsRow
              icon={BellIcon}
              label="Push notifications"
              hint="Receive alerts about your board"
              right={
                <Switch
                  value={notifications}
                  onValueChange={setNotifications}
                  trackColor={{ false: theme.palette.slate.border, true: theme.palette.sky.border }}
                  thumbColor={
                    notifications ? theme.palette.sky.color : theme.palette.slate.textMuted
                  }
                />
              }
            />
            <SettingsRow
              icon={WifiHighIcon}
              label="Connection alerts"
              hint="Notify when board connects or disconnects"
              onPress={() => {}}
            />
          </SettingsCard>
        </ShowcaseCard>

        <ShowcaseCard name="BoardTopSpeedCard">
          <BoardTopSpeedCard value={boardTopSpeed} onChange={setBoardTopSpeed} />
        </ShowcaseCard>

        <ShowcaseCard name="ConnectionPausedCard">
          <ConnectionPausedCard
            boardName="Blue Board"
            remaining="1 h 20 min"
            reason="you ended the ride"
            onConnectNow={() => {}}
          />
        </ShowcaseCard>

        <ShowcaseCard name="AutoStartCard">
          <AutoStartCard {...autoStart} />
        </ShowcaseCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
