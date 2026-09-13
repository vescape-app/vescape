import { StyleSheet, View } from 'react-native'
import type { AccessoryCapability } from 'vescape-core'

import { Text } from '@/components/base/Text'
import {
  capabilityLimits,
  capabilityPresentation,
} from '@/modules/accessories/constants/accessoryCapabilities'
import { theme } from '@/constants/theme'

/**
 * One capability an Accessory declares, with what the app can do about it.
 *
 * An unsupported capability is shown rather than filtered out: a rider holding hardware Vescape
 * half-understands should be told which half, not handed a shorter list.
 */
export function AccessoryCapabilityRow({ capability }: { capability: AccessoryCapability }) {
  const { title, description, icon: CapabilityIcon } = capabilityPresentation(capability)
  const limits = capabilityLimits(capability)
  const tint = capability.supported ? theme.palette.sky.color : theme.neutral.textDim

  return (
    <View style={styles.row}>
      <View style={styles.icon}>
        <CapabilityIcon size={18} color={tint} weight="duotone" />
      </View>
      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={[styles.badge, { borderColor: tint }]}>
            <Text style={[styles.badgeText, { color: tint }]}>
              {capability.supported ? 'Supported' : 'Unsupported'}
            </Text>
          </View>
        </View>
        <Text style={styles.description}>{description}</Text>
        <Text style={styles.meta}>
          {capability.id}
          {limits ? ` · ${limits}` : ''}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.alpha(theme.neutral.border, 0.6),
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 3,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flexShrink: 1,
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  description: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  meta: {
    fontFamily: theme.mono('600'),
    color: theme.neutral.textDim,
    fontSize: 11,
  },
})
