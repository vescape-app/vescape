import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CompassIcon } from 'phosphor-react-native'
import { useShallow } from 'zustand/react/shallow'

import { theme } from '@/constants/theme'
import { IconHero } from '@/components/settings/IconHero'
import {
  buildNavigationDiagnosticsViewModel,
  type DiagnosticRow,
} from '@/modules/map/lib/navigationDiagnostics'
import { useNavigationDiagnosticsStore } from '@/modules/map/store/navigationDiagnosticsStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

export default function NavigationDiagnosticScreen() {
  const mapOrientationMode = useSettingsStore((s) => s.mapOrientationMode)
  const mapStyleKey = useSettingsStore((s) => s.mapStyleKey)
  const [now, setNow] = useState(() => Date.now())
  const diagnostics = useNavigationDiagnosticsStore(
    useShallow((s) => ({
      gpsFix: s.gpsFix,
      retainedGpsBearingDeg: s.retainedGpsBearingDeg,
      retainedGpsBearingAt: s.retainedGpsBearingAt,
      phoneHeadingDeg: s.phoneHeadingDeg,
      phoneHeadingStatus: s.phoneHeadingStatus,
      activeDisplayHeadingDeg: s.activeDisplayHeadingDeg,
      cameraHeadingDeg: s.cameraHeadingDeg,
      fallbackReason: s.fallbackReason,
      updatedAt: s.updatedAt,
    })),
  )
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const vm = useMemo(
    () =>
      buildNavigationDiagnosticsViewModel({
        mapOrientationMode,
        mapStyleKey,
        ...diagnostics,
        now,
      }),
    [diagnostics, mapOrientationMode, mapStyleKey, now],
  )

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero icon={CompassIcon} description="Live map heading, GPS, and fallback evidence." />
        <Text style={styles.sectionTitle}>Navigation</Text>
        <View style={styles.card}>
          <DiagnosticRowView label="Selected mode" value={vm.selectedMode} />
          <DiagnosticRowView label="Map style" value={vm.mapStyle} />
          <DiagnosticRowView label="Heading-source readiness" value={vm.readiness} />
          <DiagnosticRowView label="Fallback reason" value={vm.fallbackReason} />
          <DiagnosticRowView label="Diagnostics age" value={vm.updatedAge} />
        </View>

        <DiagnosticSection title="GPS" rows={vm.gpsRows} />
        <DiagnosticSection title="Heading" rows={vm.headingRows} />
        <DiagnosticSection title="Board heading reserved" rows={vm.boardRows} />
      </ScrollView>
    </SafeAreaView>
  )
}

function DiagnosticSection({ title, rows }: { title: string; rows: DiagnosticRow[] }) {
  return (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        {rows.map((row) => (
          <DiagnosticRowView key={row.label} label={row.label} value={row.value} />
        ))}
      </View>
    </>
  )
}

function DiagnosticRowView({ label, value }: DiagnosticRow) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.palette.slate.bg,
  },
  content: {
    padding: 16,
    gap: 8,
  },
  sectionTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 4,
  },
  card: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    overflow: 'hidden',
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.palette.slate.border,
  },
  rowLabel: {
    flex: 1,
    color: theme.palette.slate.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  rowValue: {
    flex: 1,
    color: theme.palette.slate.textPrimary,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
})
