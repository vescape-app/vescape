import { draftAlertPreview } from '@/modules/alerts/lib/draftAlertPreview'
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
import { theme, type ThemeColor } from '@/constants/theme'
import { ALERT_PRESET_METRICS, type AlertPresetMetric } from '@/modules/alerts/lib/alertPresets'
import { useAlertPresetFormat } from '@/modules/alerts/hooks/useAlertPresetFormat'
import { WizardStepLayout } from '@/modules/board/components/add-board-wizard/WizardStepLayout'
import { ALERT_METRIC_META } from '@/modules/board/components/add-board-wizard/alertMetricMeta'
import type { UseAddBoardWizard } from '@/modules/board/hooks/useAddBoardWizard'
import { formatBmsSuffix, formatBoardTransport } from '@/modules/board/lib/boardTransport'

export function ConfirmStep({ wizard }: { wizard: UseAddBoardWizard }) {
  const { formatSummary } = useAlertPresetFormat()
  const { alertSummaries, previewErrors } = useMemo(() => {
    const errors: string[] = []
    const summaries = ALERT_PRESET_METRICS.map((metric) => {
      const { level, rules } = wizard.alertSetup[metric]
      const preview = draftAlertPreview(
        metric,
        level,
        {
          speedUnitSystem: wizard.alertSetup.speed.speedUnitSystem,
          topSpeedKmh: wizard.topSpeedKmh,
          hasBatteryConfig: wizard.hasBatteryConfig,
        },
        rules,
      )
      if (preview.error) errors.push(`${ALERT_METRIC_META[metric].name}: ${preview.error}`)
      const summary =
        level === 'custom'
          ? `${rules.length} custom ${rules.length === 1 ? 'alert' : 'alerts'}`
          : formatSummary(metric, preview.rules)
      return { metric, summary }
    }).filter((row): row is { metric: AlertPresetMetric; summary: string } => row.summary != null)
    return { alertSummaries: summaries, previewErrors: errors }
  }, [wizard.alertSetup, wizard.hasBatteryConfig, wizard.topSpeedKmh, formatSummary])

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
            disabled={!wizard.canSave || previewErrors.length > 0}
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
          iconColor={theme.palette.orange.color}
          label="Name"
          value={wizard.name.trim() || 'Unnamed board'}
        />
        {wizard.description.trim() ? (
          <>
            <View style={styles.divider} />
            <ConfirmRow
              icon={TextTIcon}
              iconColor={theme.palette.orange.color}
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
      {previewErrors.map((error) => (
        <Text key={error} style={{ color: theme.status.error.color }}>
          {error}
        </Text>
      ))}
      <View style={styles.card}>
        {alertSummaries.length === 0 ? (
          <ConfirmRow
            icon={BellRingingIcon}
            iconColor={theme.palette.amber.color}
            label="Alerts"
            value={previewErrors.length ? 'Preview unavailable' : 'All off'}
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
  iconColor: ThemeColor
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
    backgroundColor: theme.neutral.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    paddingVertical: 4,
  },
  sectionTitle: {
    color: theme.neutral.textMuted,
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
    backgroundColor: theme.neutral.border,
    marginLeft: 42,
  },
  label: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  value: {
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
})
