import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import type { VescFaultCaptureDetail } from 'vescape-core'

import { Text } from '@/components/base/Text'
import {
  achievedRateHz,
  captureOffsetMs,
  captureSpanMs,
  fmtCaptureOffset,
  samplesAroundIncident,
} from '@/modules/board/lib/vescFaultCapture'
import { theme } from '@/constants/theme'

/** Newest pre-fault rows to render. Remaining samples stay in native storage. */
const VISIBLE_SAMPLES = 40

interface VescFaultCaptureSectionProps {
  /** Native pre-fault capture for this occurrence. */
  capture: VescFaultCaptureDetail | null
  loading: boolean
}

/**
 * The VESC Fault Capture for one occurrence: how much evidence exists, at what rate it actually
 * arrived, and the decoded values around the incident.
 *
 * Presentation only. Native copies its existing recent window once at detection. Rate comes from
 * retained timestamps because the Board Session is response-paced.
 */
export function VescFaultCaptureSection({ capture, loading }: VescFaultCaptureSectionProps) {
  if (loading) {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={theme.neutral.textMuted} />
      </View>
    )
  }

  if (capture == null || capture.samples.length === 0) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>No telemetry capture available for this fault.</Text>
      </View>
    )
  }

  const samples = capture.samples
  const span = captureSpanMs(samples)
  const rate = achievedRateHz(samples)
  const { shown, omitted } = samplesAroundIncident(samples, VISIBLE_SAMPLES)

  return (
    <View style={styles.container}>
      <View style={styles.stats}>
        <Stat label="Samples" value={String(capture.sampleCount)} />
        <Stat label="Span" value={span == null ? '—' : `${(span / 1000).toFixed(1)}s`} />
        <Stat label="Rate" value={rate == null ? '—' : `${rate.toFixed(1)} Hz`} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.cell, styles.headerCell, styles.offsetCell]}>t</Text>
            <Text style={[styles.cell, styles.headerCell]}>km/h</Text>
            <Text style={[styles.cell, styles.headerCell]}>duty</Text>
            <Text style={[styles.cell, styles.headerCell]}>motor A</Text>
            <Text style={[styles.cell, styles.headerCell]}>batt A</Text>
            <Text style={[styles.cell, styles.headerCell]}>volts</Text>
            <Text style={[styles.cell, styles.headerCell]}>pitch</Text>
          </View>
          {shown.map((sample) => {
            return (
              <View key={sample.capturedAtMs} style={styles.row}>
                <Text style={[styles.cell, styles.offsetCell, styles.offsetText]}>
                  {fmtCaptureOffset(captureOffsetMs(sample, capture))}
                </Text>
                <Text style={styles.cell}>{num(sample.speed, 1)}</Text>
                <Text style={styles.cell}>{num(sample.dutyCycle, 2)}</Text>
                <Text style={styles.cell}>{num(sample.motorCurrent, 1)}</Text>
                <Text style={styles.cell}>{num(sample.batteryCurrent, 1)}</Text>
                <Text style={styles.cell}>{num(sample.batteryVoltage, 1)}</Text>
                <Text style={styles.cell}>{num(sample.pitch, 1)}</Text>
              </View>
            )
          })}
        </View>
      </ScrollView>

      {omitted > 0 && (
        <Text style={styles.stateText}>
          Showing {shown.length} samples before detection · {omitted} more retained.
        </Text>
      )}
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  )
}

/** A field the firmware did not report stays visibly absent instead of rendering as zero. */
function num(value: number | null, digits: number): string {
  return value == null ? '—' : value.toFixed(digits)
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  state: { paddingVertical: 8 },
  stateText: { color: theme.neutral.textMuted, fontSize: 12 },
  stats: { flexDirection: 'row', gap: 16 },
  stat: { gap: 2 },
  statLabel: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: { color: theme.neutral.textPrimary, fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', paddingVertical: 2 },
  headerRow: { borderBottomWidth: 1, borderBottomColor: theme.neutral.border, paddingBottom: 4 },
  cell: {
    color: theme.neutral.textSecondary,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    width: 62,
    textAlign: 'right',
  },
  offsetCell: { width: 64, textAlign: 'left' },
  offsetText: { color: theme.neutral.textMuted },
  headerCell: {
    color: theme.neutral.textMuted,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
})
