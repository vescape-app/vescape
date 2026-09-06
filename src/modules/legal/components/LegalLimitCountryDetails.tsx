import {
  BellIcon,
  GaugeIcon,
  LightbulbIcon,
  MapPinLineIcon,
  RoadHorizonIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
  type Icon,
} from 'phosphor-react-native'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'
import {
  getLegalLimitCountryDetail,
  LEGAL_ROAD_STATUS_COLORS,
  LEGAL_ROAD_STATUS_LABELS,
  type LegalLimitCountry,
} from '@/modules/legal/lib/legalLimits'

import { LEGAL_LIMIT_STATUS_ICONS } from '@/modules/legal/lib/legalLimitStatusIcon'

interface LegalLimitCountryDetailsProps {
  country: LegalLimitCountry
}

interface DetailRowProps {
  icon: Icon
  title: string
  body: string
}

interface AlertRowProps {
  color: string
  text: string
}

export function LegalLimitCountryDetails({ country }: LegalLimitCountryDetailsProps) {
  const surface = useResolvedSecondaryWidgetSurface()
  const detail = getLegalLimitCountryDetail(country)
  const statusColor = LEGAL_ROAD_STATUS_COLORS[country.status]
  const StatusIcon = LEGAL_LIMIT_STATUS_ICONS[country.status]
  const speedLabel = country.referenceSpeedKmh == null ? 'N/A' : `${country.referenceSpeedKmh} km/h`

  return (
    <View style={styles.container}>
      <View style={styles.badgeGrid}>
        <View style={[surface, styles.badge, { borderColor: theme.alpha(statusColor, 0.6) }]}>
          <View style={styles.badgeIcon}>
            <StatusIcon size={17} color={statusColor} weight="fill" />
          </View>
          <View style={styles.badgeText}>
            <Text style={styles.badgeLabel}>Road status</Text>
            <Text style={styles.badgeValue}>{LEGAL_ROAD_STATUS_LABELS[country.status]}</Text>
          </View>
        </View>
        <View style={[surface, styles.badge, styles.speedBadge]}>
          <View style={styles.speedBadgeMain}>
            <View style={styles.badgeIcon}>
              <GaugeIcon size={17} color={theme.palette.sky.text} weight="fill" />
            </View>
            <View style={styles.badgeText}>
              <Text style={styles.badgeLabel}>Top speed</Text>
              <Text style={styles.badgeValue}>{speedLabel}</Text>
            </View>
          </View>
          <Text style={styles.badgeCaption} numberOfLines={3}>
            {country.speedLimitBasis}
          </Text>
        </View>
      </View>

      {country.warningText ? <AlertRow color={statusColor} text={country.warningText} /> : null}

      {detail ? (
        <View style={styles.sections}>
          <DetailRow icon={RoadHorizonIcon} title="Vehicle scope" body={detail.vehicleScope} />
          <DetailRow icon={MapPinLineIcon} title="Where you can ride" body={detail.where} />
          <DetailRow icon={LightbulbIcon} title="Requirements" body={detail.equipment} />
          <DetailRow icon={BellIcon} title="Insurance" body={detail.insurance} />
          <DetailRow icon={ShieldCheckIcon} title="Notes" body={detail.notes} />
        </View>
      ) : null}

      <View style={[surface, styles.sourceCard]}>
        <Text style={styles.sourceLabel}>Checked</Text>
        <Text style={styles.sourceValue}>{country.checkedAt}</Text>
        <Text style={styles.sourceLabel}>Source</Text>
        <Text style={styles.sourceUrl} numberOfLines={2}>
          {country.sourceUrl}
        </Text>
      </View>
    </View>
  )
}

function AlertRow({ color, text }: AlertRowProps) {
  const surface = useResolvedSecondaryWidgetSurface()
  return (
    <View
      style={[
        surface,
        styles.alertRow,
        {
          borderColor: theme.alpha(color, 0.6),
        },
      ]}
    >
      <View style={styles.alertIcon}>
        <WarningCircleIcon size={16} color={color} weight="fill" />
      </View>
      <Text style={styles.alertText}>{text}</Text>
    </View>
  )
}

function DetailRow({ icon: IconComponent, title, body }: DetailRowProps) {
  const surface = useResolvedSecondaryWidgetSurface()
  return (
    <View style={[surface, styles.detailRow]}>
      <View style={styles.detailIcon}>
        <IconComponent size={16} color={theme.neutral.textPrimary} weight="fill" />
      </View>
      <View style={styles.detailText}>
        <Text style={styles.detailTitle}>{title}</Text>
        <Text style={styles.detailBody}>{body}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  badgeGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    flex: 1,
    minHeight: 70,
    padding: 10,
    gap: 8,
  },
  speedBadge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  speedBadgeMain: {
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  badgeIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.palette.sky.color, 0.12),
  },
  badgeText: {
    flex: 1,
    gap: 2,
  },
  badgeLabel: {
    color: theme.neutral.textDim,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  badgeValue: {
    color: theme.neutral.textPrimary,
    fontSize: 13,
    fontWeight: '900',
  },
  badgeCaption: {
    flex: 1,
    minWidth: 0,
    color: theme.neutral.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
    textAlign: 'right',
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 54,
    padding: 11,
  },
  alertIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertText: {
    flex: 1,
    color: theme.neutral.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  sections: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 11,
  },
  detailIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.palette.slate.light, 0.12),
  },
  detailText: {
    flex: 1,
    gap: 3,
  },
  detailTitle: {
    color: theme.neutral.textPrimary,
    fontSize: 12,
    fontWeight: '900',
  },
  detailBody: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  sourceCard: {
    padding: 11,
    gap: 4,
  },
  sourceLabel: {
    color: theme.neutral.textDim,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  sourceValue: {
    color: theme.neutral.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  sourceUrl: {
    color: theme.palette.sky.text,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
  },
})
