import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import {
  ChatTextIcon,
  PlusIcon,
  RadioactiveIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  TrashIcon,
  WaveformIcon,
} from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { theme } from '@/constants/theme'
import type { DerivedBatteryConfig } from '@/modules/battery/lib/types'
import { AlertFormModal } from '@/modules/alerts/components/AlertFormModal'
import type { DraftAlertRule } from '@/modules/alerts/lib/customAlertRules'
import type { MetricAlertsController } from '@/modules/alerts/hooks/useMetricAlerts'
import type { AlertRuleDraft } from '@/modules/alerts/store/alertsStore'

/**
 * The rider's own Alert Rules for one control: rows with mute + delete, and the add/edit form.
 * Purely a view over a {@link MetricAlertsController}, so the same list serves a saved Board and
 * the add-board wizard's draft.
 */
export function AlertRuleList({
  controller,
  unit,
  batteryConfig,
}: {
  controller: MetricAlertsController
  unit: string
  /** Set for battery, whose rules are state-of-charge % rather than raw volts. */
  batteryConfig: DerivedBatteryConfig | null
}) {
  const [formVisible, setFormVisible] = useState(false)
  const [editRule, setEditRule] = useState<DraftAlertRule | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DraftAlertRule | null>(null)

  const closeForm = () => {
    setFormVisible(false)
    setEditRule(null)
  }

  const handleSave = (draft: AlertRuleDraft) => {
    if (editRule) controller.updateRule(editRule.id, draft)
    else controller.addRule(draft)
    closeForm()
  }

  return (
    <>
      {controller.rules.map((rule) => (
        <AlertRuleRow
          key={rule.id}
          rule={rule}
          unit={unit}
          batteryConfig={batteryConfig}
          onEdit={() => {
            setEditRule(rule)
            setFormVisible(true)
          }}
          onToggle={() => controller.toggleRule(rule.id)}
          onDelete={() => setDeleteTarget(rule)}
        />
      ))}

      {controller.rules.length === 0 ? (
        <Text style={styles.emptyHintText}>
          No alerts yet — get notified when this crosses a threshold
        </Text>
      ) : null}

      <View style={styles.addButtonRow}>
        <Button
          label="Add alert"
          icon={PlusIcon}
          variant="secondary"
          size="sm"
          onPress={() => {
            setEditRule(null)
            setFormVisible(true)
          }}
        />
      </View>

      <AlertFormModal
        visible={formVisible}
        controlId={controller.controlId}
        unit={unit}
        editRule={editRule}
        batteryConfig={batteryConfig}
        onClose={closeForm}
        onSave={handleSave}
      />

      <ConfirmModal
        visible={deleteTarget != null}
        title="Delete Alert"
        message="Remove this alert? This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) controller.removeRule(deleteTarget.id)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}

function AlertRuleRow({
  rule,
  unit,
  batteryConfig,
  onEdit,
  onToggle,
  onDelete,
}: {
  rule: DraftAlertRule
  unit: string
  batteryConfig: DerivedBatteryConfig | null
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const isGeiger = rule.thresholdMax != null
  const isTts = rule.soundType.startsWith('tts:')
  const TypeIcon = isGeiger ? RadioactiveIcon : isTts ? ChatTextIcon : WaveformIcon
  const detail = [
    rule.repeatEverySeconds == null ? null : `every ${rule.repeatEverySeconds}s`,
    isGeiger || isTts ? null : `${rule.beepCount}×`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <TouchableOpacity style={styles.ruleRow} onPress={onEdit} activeOpacity={0.7}>
      <View style={styles.ruleTypeIcon}>
        <TypeIcon
          size={18}
          color={rule.enabled ? theme.palette.orange.color : theme.neutral.textDim}
          weight="duotone"
        />
      </View>

      <View style={styles.ruleContent}>
        <Text style={[styles.ruleThreshold, !rule.enabled && styles.ruleTextDisabled]}>
          {isGeiger
            ? `${formatAlertValue(rule.threshold, batteryConfig, unit)} – ${formatAlertValue(rule.thresholdMax!, batteryConfig, unit)}`
            : formatAlertValue(rule.threshold, batteryConfig, unit)}
        </Text>
        {isTts && (
          <Text
            style={[styles.ruleTtsTemplate, !rule.enabled && styles.ruleTextDisabled]}
            numberOfLines={1}
          >
            {rule.soundType.slice(4)}
          </Text>
        )}
        {detail ? (
          <Text style={[styles.ruleDetail, !rule.enabled && styles.ruleTextDisabled]}>
            {detail}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        hitSlop={8}
        style={styles.ruleAction}
      >
        {rule.enabled ? (
          <SpeakerHighIcon size={16} color={theme.palette.orange.color} />
        ) : (
          <SpeakerSlashIcon size={16} color={theme.neutral.textDim} />
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        hitSlop={8}
        style={styles.ruleAction}
      >
        <TrashIcon size={15} color={theme.status.error.color} />
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

function formatAlertValue(value: number, bc: DerivedBatteryConfig | null, unit: string) {
  if (bc) return `${Math.round(value)}%`
  return `${value}${unit ? ` ${unit}` : ''}`
}

const styles = StyleSheet.create({
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  ruleTypeIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.neutral.surface,
  },
  ruleContent: {
    flex: 1,
  },
  ruleThreshold: {
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  ruleTtsTemplate: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  ruleDetail: {
    color: theme.palette.slate.textDim,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  ruleTextDisabled: {
    color: theme.neutral.textDim,
  },
  ruleAction: {
    padding: 6,
  },
  addButtonRow: {
    alignItems: 'center',
    marginTop: 2,
  },
  emptyHintText: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
})
