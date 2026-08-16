import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  BatteryFullIcon,
  BellRingingIcon,
  BluetoothIcon,
  CheckCircleIcon,
  TextTIcon,
  type Icon,
} from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import type { WizardStepId } from '@/modules/board/hooks/useAddBoardWizard'

const STEP_META: Record<WizardStepId, { label: string; icon: Icon; color: string }> = {
  scan: { label: 'Pair', icon: BluetoothIcon, color: theme.palette.sky.color },
  name: { label: 'Name', icon: TextTIcon, color: theme.palette.orange.color },
  battery: { label: 'Battery', icon: BatteryFullIcon, color: theme.palette.green.color },
  presets: { label: 'Alerts', icon: BellRingingIcon, color: theme.palette.amber.color },
  confirm: { label: 'Confirm', icon: CheckCircleIcon, color: theme.palette.purple.color },
}

interface Props {
  steps: readonly WizardStepId[]
  step: number
  alertSubstep?: {
    index: number
    total: number
  }
}

export function WizardProgress({ steps, step, alertSubstep }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        {steps.map((id, index) => {
          const showAlertSubsteps = id === 'presets' && alertSubstep != null
          return (
            <View
              key={id}
              style={[
                styles.segment,
                index <= step && !showAlertSubsteps
                  ? { backgroundColor: STEP_META[id].color }
                  : undefined,
                showAlertSubsteps && styles.alertSegment,
              ]}
            >
              {showAlertSubsteps
                ? Array.from({ length: alertSubstep.total }, (_, segmentIndex) => (
                    <View
                      key={segmentIndex}
                      style={[
                        styles.alertSubsegment,
                        segmentIndex <= alertSubstep.index && styles.alertSubsegmentActive,
                      ]}
                    />
                  ))
                : null}
            </View>
          )
        })}
      </View>
      <View style={styles.labels}>
        {steps.map((id, index) => {
          const meta = STEP_META[id]
          const active = index <= step
          return (
            <View key={id} style={styles.labelItem}>
              <meta.icon
                size={12}
                color={active ? meta.color : theme.neutral.textDim}
                weight="bold"
              />
              <Text style={[styles.label, active && { color: meta.color }]} numberOfLines={1}>
                {meta.label}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    marginBottom: 12,
  },
  bar: {
    flexDirection: 'row',
    gap: 4,
  },
  segment: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.neutral.border,
  },
  alertSegment: {
    flexDirection: 'row',
    gap: 2,
    backgroundColor: 'transparent',
  },
  alertSubsegment: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.neutral.border,
  },
  alertSubsegmentActive: {
    backgroundColor: theme.palette.amber.color,
  },
  labels: {
    flexDirection: 'row',
    gap: 4,
  },
  labelItem: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  label: {
    flex: 1,
    minWidth: 0,
    color: theme.neutral.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
})
