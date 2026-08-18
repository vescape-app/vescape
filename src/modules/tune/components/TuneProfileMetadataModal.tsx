import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import {
  CheckIcon,
  BatteryChargingIcon,
  CompassIcon,
  FadersIcon,
  FireIcon,
  FlagCheckeredIcon,
  GaugeIcon,
  GearSixIcon,
  HeartbeatIcon,
  LeafIcon,
  LightningIcon,
  MountainsIcon,
  RoadHorizonIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SnowflakeIcon,
  SparkleIcon,
  SunHorizonIcon,
  TargetIcon,
  TireIcon,
  WaveSineIcon,
  WindIcon,
  WrenchIcon,
  type Icon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { Input } from '@/components/forms/Input'
import {
  DEFAULT_TUNE_PROFILE_COLOR,
  DEFAULT_TUNE_PROFILE_ICON,
  TUNE_PROFILE_COLOR_IDS,
  TUNE_PROFILE_ICON_IDS,
  tuneProfileColorId,
  tuneProfileIconId,
  type TuneProfileColorId,
  type TuneProfileIconId,
} from '@/modules/tune/lib/profileMetadata'
import { theme } from '@/constants/theme'

export interface TuneProfileMetadataValue {
  name: string
  icon: TuneProfileIconId
  color: TuneProfileColorId
}

interface TuneProfileMetadataModalProps {
  visible: boolean
  title: string
  confirmLabel: string
  initialValue?: Partial<TuneProfileMetadataValue>
  onConfirm: (value: TuneProfileMetadataValue) => void
  onDismiss: () => void
}

interface TuneProfileMetadataModalContentProps extends Omit<
  TuneProfileMetadataModalProps,
  'visible'
> {
  initialValue: Partial<TuneProfileMetadataValue>
}

interface PaletteTheme {
  bg: string
  border: string
  color: string
  text: string
}

const ICONS: Record<TuneProfileIconId, Icon> = {
  'sliders-horizontal': SlidersHorizontalIcon,
  faders: FadersIcon,
  lightning: LightningIcon,
  mountains: MountainsIcon,
  'road-horizon': RoadHorizonIcon,
  'rocket-launch': RocketLaunchIcon,
  gauge: GaugeIcon,
  'wave-sine': WaveSineIcon,
  snowflake: SnowflakeIcon,
  'sun-horizon': SunHorizonIcon,
  'battery-charging': BatteryChargingIcon,
  compass: CompassIcon,
  fire: FireIcon,
  'flag-checkered': FlagCheckeredIcon,
  'gear-six': GearSixIcon,
  heartbeat: HeartbeatIcon,
  leaf: LeafIcon,
  'shield-check': ShieldCheckIcon,
  sparkle: SparkleIcon,
  target: TargetIcon,
  tire: TireIcon,
  wind: WindIcon,
  wrench: WrenchIcon,
}

const ICON_LABELS: Record<TuneProfileIconId, string> = {
  'sliders-horizontal': 'Tune',
  faders: 'Control',
  lightning: 'Power',
  mountains: 'Trail',
  'road-horizon': 'Street',
  'rocket-launch': 'Fast',
  gauge: 'Stable',
  'wave-sine': 'Smooth',
  snowflake: 'Chill',
  'sun-horizon': 'Cruise',
  'battery-charging': 'Battery',
  compass: 'Explore',
  fire: 'Hot',
  'flag-checkered': 'Race',
  'gear-six': 'Technical',
  heartbeat: 'Responsive',
  leaf: 'Eco',
  'shield-check': 'Safe',
  sparkle: 'Clean',
  target: 'Precise',
  tire: 'Grip',
  wind: 'Flow',
  wrench: 'Setup',
}

const COLORS: Record<TuneProfileColorId, PaletteTheme> = {
  purple: theme.palette.purple,
  cyan: theme.palette.cyan,
  sky: theme.palette.sky,
  green: theme.palette.green,
  amber: theme.palette.amber,
  orange: theme.palette.orange,
  red: theme.palette.red,
  yellow: theme.palette.yellow,
  blue: theme.palette.blue,
  fuchsia: theme.palette.fuchsia,
  pink: theme.palette.pink,
  violet: theme.palette.violet,
}

export function tuneProfileIconComponent(icon: string | null | undefined): Icon {
  return ICONS[tuneProfileIconId(icon)]
}

export function TuneProfileIcon({
  icon,
  size,
  color,
  weight = 'duotone',
}: {
  icon: string | null | undefined
  size: number
  color: string
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
}) {
  const IconComponent = ICONS[tuneProfileIconId(icon)]
  return <IconComponent size={size} color={color} weight={weight} />
}

export function tuneProfileColorTheme(color: string | null | undefined): PaletteTheme {
  return COLORS[tuneProfileColorId(color)]
}

function TuneProfileMetadataModalContent({
  title,
  confirmLabel,
  initialValue,
  onConfirm,
  onDismiss,
}: TuneProfileMetadataModalContentProps) {
  const [name, setName] = useState(initialValue?.name ?? '')
  const [icon, setIcon] = useState<TuneProfileIconId>(
    tuneProfileIconId(initialValue?.icon ?? DEFAULT_TUNE_PROFILE_ICON),
  )
  const [color, setColor] = useState<TuneProfileColorId>(
    tuneProfileColorId(initialValue?.color ?? DEFAULT_TUNE_PROFILE_COLOR),
  )

  const accent = COLORS[color]

  return (
    <Pressable style={styles.backdrop} onPress={onDismiss}>
      <Pressable style={styles.modal} onPress={(event) => event.stopPropagation()}>
        <Text style={styles.title}>{title}</Text>
        <Input
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="Tune name"
          placeholderTextColor={theme.palette.slate.textDim}
          autoFocus
          selectTextOnFocus
        />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Icon</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.iconRow}
          >
            {TUNE_PROFILE_ICON_IDS.map((iconId) => {
              const selected = iconId === icon
              return (
                <Pressable
                  key={iconId}
                  style={[
                    styles.iconChoice,
                    selected && { borderColor: accent.border, backgroundColor: accent.bg },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={ICON_LABELS[iconId]}
                  accessibilityState={{ selected }}
                  onPress={() => setIcon(iconId)}
                >
                  <TuneProfileIcon
                    icon={iconId}
                    size={22}
                    color={selected ? accent.color : theme.palette.slate.textSecondary}
                  />
                </Pressable>
              )
            })}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Color</Text>
          <View style={styles.colorGrid}>
            {TUNE_PROFILE_COLOR_IDS.map((colorId) => {
              const swatch = COLORS[colorId]
              const selected = colorId === color
              return (
                <Pressable
                  key={colorId}
                  style={[
                    styles.colorChoice,
                    { borderColor: selected ? swatch.color : theme.palette.slate.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${colorId} color`}
                  accessibilityState={{ selected }}
                  onPress={() => setColor(colorId)}
                >
                  <View style={[styles.swatch, { backgroundColor: swatch.bg }]}>
                    <View style={[styles.swatchLine, { backgroundColor: swatch.color }]} />
                    {selected ? <CheckIcon size={14} color={swatch.color} weight="bold" /> : null}
                  </View>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.cancelButton} onPress={onDismiss}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.confirmButton, { backgroundColor: accent.color }]}
            onPress={() => {
              const trimmed = name.trim()
              if (!trimmed) return
              onConfirm({ name: trimmed, icon, color })
            }}
          >
            <CheckIcon size={15} color={theme.palette.slate.surfaceDeep} weight="bold" />
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </Pressable>
    </Pressable>
  )
}

export function TuneProfileMetadataModal({
  visible,
  initialValue,
  ...props
}: TuneProfileMetadataModalProps) {
  const key = `${initialValue?.name ?? ''}:${initialValue?.icon ?? ''}:${initialValue?.color ?? ''}`

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={props.onDismiss}>
      {visible ? (
        <TuneProfileMetadataModalContent key={key} initialValue={initialValue ?? {}} {...props} />
      ) : null}
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.6),
    padding: 24,
  },
  modal: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    padding: 16,
    gap: 16,
  },
  title: {
    color: theme.palette.slate.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  nameInput: {
    fontSize: 16,
    fontWeight: '700',
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  iconRow: {
    gap: 8,
    paddingRight: 8,
  },
  iconChoice: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  colorChoice: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  swatchLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 4,
    left: 0,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  confirmButton: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  confirmText: {
    color: theme.palette.slate.surfaceDeep,
    fontSize: 13,
    fontWeight: '900',
  },
})
