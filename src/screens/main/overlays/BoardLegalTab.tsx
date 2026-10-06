import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { CaretRightIcon, InfoIcon, SirenIcon, SpeedometerIcon } from 'phosphor-react-native'

import { Switch } from '@/components/controls/Switch'
import { InfoModal } from '@/components/modals/InfoModal'
import { Text } from '@/components/base/Text'
import {
  useResolvedSecondaryWidgetPressed,
  useResolvedSecondaryWidgetSurface,
} from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import { errorMessage } from '@/helpers/error'
import { useResolvedColor } from '@/hooks/useTheme'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useLegalReferenceSpeedFormat } from '@/modules/legal/hooks/useLegalLimitsFormat'
import { LEGAL_LIMIT_STATUS_ICONS } from '@/modules/legal/lib/legalLimitStatusIcon'
import {
  LEGAL_ROAD_STATUS_COLORS,
  LEGAL_ROAD_STATUS_LABELS,
  type LegalLimitCountry,
} from '@/modules/legal/lib/legalLimits'
import { legalPolicyFromReference } from '@/modules/legal/lib/legalMode'
import { useLegalModeStore } from '@/modules/legal/store/legalModeStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/** Legal Mode is broken for now, so its switch shows the state but refuses input. */
const LEGAL_MODE_SWITCH_ENABLED = false

/** Legal Mode, the jurisdiction it follows, and the way into the Legal Limits map. */
export function BoardLegalTab({ onOpenLegalLimits }: { onOpenLegalLimits: () => void }) {
  const surface = useResolvedSecondaryWidgetSurface()
  const pressedSurface = useResolvedSecondaryWidgetPressed()
  // The message outlives `visible` on purpose: `FadeCardModal` keeps rendering its children through
  // the exit animation, so clearing it on dismiss would blank the card as it fades.
  const [legalModeError, setLegalModeError] = useState({ message: '', visible: false })
  const activeBoardId = useBoardStore((state) => state.activeBoardId)
  const legalModeEnabled = useBoardStore(
    (state) =>
      state.boards.find((board) => board.id === state.activeBoardId)?.legalMode?.enabled ?? false,
  )
  const setLegalModeEnabled = useLegalModeStore((state) => state.setEnabled)
  const legalPolicyReference = useSettingsStore((state) => state.legalPolicy)
  const legalPolicy = useMemo(
    () => legalPolicyFromReference(legalPolicyReference),
    [legalPolicyReference],
  )

  const toggleLegalMode = (enabled: boolean) => {
    if (!activeBoardId) return
    void setLegalModeEnabled(activeBoardId, enabled).catch((error: unknown) => {
      setLegalModeError({
        message: errorMessage(error, 'Could not change Legal Mode.'),
        visible: true,
      })
    })
  }

  return (
    <View style={styles.content}>
      <View
        style={[
          surface,
          styles.modeCard,
          legalModeEnabled && { borderColor: theme.status.error.border },
        ]}
      >
        <View style={styles.modeRow}>
          <View style={[styles.modeIcon, { backgroundColor: theme.status.error.bg }]}>
            <SirenIcon size={26} color={theme.status.error.color} weight="duotone" />
          </View>
          <View style={styles.modeText}>
            <Text style={styles.modeTitle}>Legal mode</Text>
            <Text style={styles.modeHint}>Caps speed to the local legal limit.</Text>
          </View>
          <Switch
            value={legalModeEnabled}
            onValueChange={toggleLegalMode}
            disabled={!LEGAL_MODE_SWITCH_ENABLED || activeBoardId == null}
            accent={theme.status.error.color}
            accessibilityLabel="Legal Mode"
          />
        </View>
        {LEGAL_MODE_SWITCH_ENABLED ? null : (
          <View style={styles.unavailable}>
            <InfoIcon size={14} color={theme.neutral.textMuted} weight="bold" />
            <Text style={styles.unavailableText}>Temporarily unavailable.</Text>
          </View>
        )}
      </View>

      {legalPolicy ? (
        <JurisdictionCard policy={legalPolicy} />
      ) : (
        <View style={[surface, styles.jurisdiction]}>
          <Text style={styles.sectionLabel}>Jurisdiction</Text>
          <Text style={styles.unresolved}>Not resolved yet. It follows your location.</Text>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [surface, styles.mapRow, pressed && pressedSurface]}
        accessibilityRole="button"
        accessibilityLabel="Legal limits map"
        onPress={onOpenLegalLimits}
      >
        <SpeedometerIcon size={26} color={theme.palette.green.color} weight="duotone" />
        <View style={styles.modeText}>
          <Text style={styles.mapTitle}>Legal limits map</Text>
          <Text style={styles.modeHint}>Road status and speed limits by country.</Text>
        </View>
        <CaretRightIcon size={16} color={theme.neutral.textMuted} weight="bold" />
      </Pressable>

      <InfoModal
        visible={legalModeError.visible}
        title="Legal Mode unavailable"
        message={legalModeError.message}
        variant="danger"
        dismissLabel="Close"
        onDismiss={() => setLegalModeError((current) => ({ ...current, visible: false }))}
      />
    </View>
  )
}

function JurisdictionCard({ policy }: { policy: LegalLimitCountry }) {
  const surface = useResolvedSecondaryWidgetSurface()
  const formatReferenceSpeed = useLegalReferenceSpeedFormat()
  const statusColor = useResolvedColor(LEGAL_ROAD_STATUS_COLORS[policy.status])
  const StatusIcon = LEGAL_LIMIT_STATUS_ICONS[policy.status]

  return (
    <View style={[surface, styles.jurisdiction]}>
      <View style={styles.jurisdictionHeader}>
        <View style={styles.modeText}>
          <Text style={styles.sectionLabel}>Jurisdiction</Text>
          <Text style={styles.countryName} numberOfLines={1}>
            {policy.name}
          </Text>
        </View>
        <View style={styles.speed}>
          <Text style={styles.sectionLabel}>Max</Text>
          <Text style={styles.speedValue}>{formatReferenceSpeed(policy.referenceSpeedKmh)}</Text>
        </View>
      </View>
      <View
        style={[
          styles.statusChip,
          {
            backgroundColor: theme.alpha(statusColor, 0.12),
            borderColor: theme.alpha(statusColor, 0.4),
          },
        ]}
      >
        <StatusIcon size={15} color={statusColor} weight="fill" />
        <Text style={[styles.statusText, { color: statusColor }]}>
          {LEGAL_ROAD_STATUS_LABELS[policy.status]}
        </Text>
      </View>
      {policy.warningText ? <Text style={styles.warning}>{policy.warningText}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
  },
  modeCard: {
    padding: 14,
    gap: 10,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modeIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  modeTitle: {
    color: theme.neutral.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  modeHint: {
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
  unavailable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unavailableText: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  sectionLabel: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  jurisdiction: {
    padding: 14,
    gap: 10,
  },
  jurisdictionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  countryName: {
    color: theme.neutral.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  unresolved: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
  },
  speed: {
    alignItems: 'flex-end',
    gap: 2,
  },
  speedValue: {
    color: theme.neutral.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  statusChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
  },
  warning: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  mapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  mapTitle: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
})
