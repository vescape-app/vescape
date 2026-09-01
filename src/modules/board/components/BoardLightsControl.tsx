import { Pressable, StyleSheet, Switch, View } from 'react-native'
import { HeadlightsIcon, LightbulbIcon, type Icon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { useBoardLights } from '@/modules/board/hooks/useBoardLights'
import { theme } from '@/constants/theme'
import { useResolvedColor, useResolvedNeutralColors } from '@/hooks/useTheme'

interface LightsCellProps {
  icon: Icon
  label: string
  /** `null` while the board has not said — the switch reads off but refuses input. */
  value: boolean | null
  disabled: boolean
  onValueChange: (value: boolean) => void
}

function LightsCell({
  icon: IconComponent,
  label,
  value,
  disabled,
  onValueChange,
}: LightsCellProps) {
  const neutral = useResolvedNeutralColors()
  const accent = useResolvedColor(theme.light.accent)
  const on = value ?? false
  const off = disabled || value == null

  return (
    <Pressable
      style={({ pressed }) => [
        styles.cell,
        off && styles.cellDisabled,
        pressed && !off && styles.cellPressed,
      ]}
      disabled={off}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on, disabled: off }}
      onPress={() => onValueChange(!on)}
    >
      <IconComponent size={22} color={theme.light.accent} weight="duotone" />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Switch
        value={on}
        onValueChange={onValueChange}
        disabled={off}
        trackColor={{ false: neutral.border, true: theme.alpha(accent, 0.6) }}
        thumbColor={on ? accent : neutral.textMuted}
        ios_backgroundColor={neutral.border}
        accessibilityLabel={label}
      />
    </Pressable>
  )
}

/**
 * The board's two light switches as one control: they are the same board feature and every write
 * states both, so they share a surface rather than sitting as two unrelated widgets.
 */
export function BoardLightsControl({ enabled }: { enabled: boolean }) {
  const surface = useResolvedSecondaryWidgetSurface()
  const lights = useBoardLights()

  return (
    <View style={[surface, styles.group]}>
      <LightsCell
        icon={LightbulbIcon}
        label="Lights"
        value={lights.enabled}
        disabled={!enabled}
        onValueChange={lights.setLights}
      />
      <View style={styles.divider} />
      <LightsCell
        icon={HeadlightsIcon}
        label="Headlight"
        value={lights.headlightsEnabled}
        disabled={!enabled}
        onValueChange={lights.setHeadlights}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  group: {
    width: '100%',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 66,
  },
  divider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: theme.neutral.border,
  },
  cell: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  cellPressed: {
    backgroundColor: theme.neutral.surface,
  },
  cellDisabled: {
    opacity: 0.45,
  },
  label: {
    flex: 1,
    minWidth: 0,
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
})
