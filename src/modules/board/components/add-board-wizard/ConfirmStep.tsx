import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  ArrowLeftIcon,
  BatteryFullIcon,
  BellRingingIcon,
  BluetoothIcon,
  CheckCircleIcon,
  TextTIcon,
  type Icon,
} from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { theme } from '@/constants/theme'
import {
  ALERT_PRESET_METRICS,
  formatAlertPresetSummary,
  type AlertPresetMetric,
} from '@/modules/alerts/lib/alertPresets'
import { WizardStepLayout } from '@/modules/board/components/add-board-wizard/WizardStepLayout'
import { ALERT_METRIC_META } from '@/modules/board/components/add-board-wizard/alertMetricMeta'
import type { UseAddBoardWizard } from '@/modules/board/hooks/useAddBoardWizard'
import { formatBmsSuffix, formatBoardTransport } from '@/modules/board/lib/boardTransport'

export function ConfirmStep({ wizard }: { wizard: UseAddBoardWizard }) {
  const alertSummaries = useMemo(() => {
    return ALERT_PRESET_METRICS.map((metric) => {
      const { level, rules } = wizard.alertSetup[metric]
      const summary =
        level === 'custom'
          ? `${rules.length} custom ${rules.length === 1 ? 'alert' : 'alerts'}`
          : formatAlertPresetSummary(metric, level, {
              boardTopSpeedKmh: wizard.topSpeedKmh,
              hasBatteryConfig: wizard.hasBatteryConfig,
            })
      return { metric, summary }
    }).filter((row): row is { metric: AlertPresetMetric; summary: string } => row.summary != null)
  }, [wizard.alertSetup, wizard.hasBatteryConfig, wizard.topSpeedKmh])

  return (
    <WizardStepLayout
      title="Review & save"
      icon={CheckCircleIcon}
      color={theme.palette.purple.color}
      footer={
        <View style={styles.actions}>
          <Button
            style={styles.action}
            label="Back"
            variant="secondary"
            icon={ArrowLeftIcon}
            onPress={wizard.back}
            testID="add-board-confirm-back"
          />
          <Button
            style={styles.action}
            label="Save"
            icon={CheckCircleIcon}
            iconPosition="right"
            onPress={() => void wizard.save()}
            disabled={!wizard.canSave}
            loading={wizard.saving}
            testID="add-board-save"
          />
        </View>
      }
    >
      <View style={styles.card}>
        <ConfirmRow
          icon={BluetoothIcon}
          iconColor={theme.palette.sky.color}
          label="Board Link"
          value={
            wizard.draftLink
              ? `${wizard.bleName || wizard.bleId} · ${formatBoardTransport(wizard.draftLink.transport)}${formatBmsSuffix(wizard.draftLink.hasBms)}`
              : 'Offline (not linked)'
          }
        />
        <View style={styles.divider} />
        <ConfirmRow
          icon={TextTIcon}
          iconColor={theme.palette.yellow.color}
          label="Name"
          value={wizard.name.trim() || 'Unnamed board'}
        />
        {wizard.description.trim() ? (
          <>
            <View style={styles.divider} />
            <ConfirmRow
              icon={TextTIcon}
              iconColor={theme.palette.yellow.color}
              label="Description"
              value={wizard.description.trim()}
            />
          </>
        ) : null}
        <View style={styles.divider} />
        <ConfirmRow
          icon={BatteryFullIcon}
          iconColor={theme.palette.green.color}
          label={wizard.batterySummary.title}
          value={wizard.batterySummary.value}
        />
      </View>

      <Text style={styles.sectionTitle}>Alerts</Text>
      <View style={styles.card}>
        {alertSummaries.length === 0 ? (
          <ConfirmRow
            icon={BellRingingIcon}
            iconColor={theme.palette.amber.color}
            label="Alerts"
            value="All off"
          />
        ) : (
          alertSummaries.map(({ metric, summary }, index) => (
            <View key={metric}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <ConfirmRow
                icon={ALERT_METRIC_META[metric].icon}
                iconColor={theme.palette.amber.color}
                label={ALERT_METRIC_META[metric].name}
                value={summary}
              />
            </View>
          ))
        )}
      </View>
    </WizardStepLayout>
  )
}

interface ConfirmRowProps {
  icon: Icon
  iconColor: string
  label: string
  value: string
}

function ConfirmRow({ icon: IconComponent, iconColor, label, value }: ConfirmRowProps) {
  return (
    <View style={styles.row}>
      <IconComponent size={16} color={iconColor} weight="duotone" />
      <View style={styles.rowText}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  action: {
    flex: 1,
  },
  card: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    paddingVertical: 4,
  },
  sectionTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  divider: {
    height: 1,
    backgroundColor: theme.palette.slate.border,
    marginLeft: 42,
  },
  label: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  value: {
    color: theme.palette.slate.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
})
