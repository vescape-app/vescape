import { Pressable, StyleSheet, View } from 'react-native'
import { ArrowLeftIcon, CaretRightIcon, CheckIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { BoardModelPreview } from '@/modules/board/components/BoardModelPreview'
import {
  CUSTOM_RAIL_BRANDS,
  CUSTOM_RAIL_OPTIONS,
  type RailBrand,
} from '@/modules/board/lib/boardPresets'
import type { RailId } from '@/modules/board/lib/railPresets'

export function CustomRailPickerContent({
  brand,
  onBrandChange,
  railId,
  railColorId,
  onSelect,
  onBack,
}: {
  brand: RailBrand | null
  onBrandChange: (brand: RailBrand | null) => void
  railId: RailId
  railColorId: string
  onSelect: (railId: RailId) => void
  onBack?: () => void
}) {
  return (
    <View style={styles.body}>
      {onBack && brand === null ? (
        <Pressable onPress={onBack} style={styles.back}>
          <ArrowLeftIcon size={16} color={theme.palette.cyan.color} />
          <Text style={styles.backText}>Board appearance</Text>
        </Pressable>
      ) : null}
      {brand === null ? (
        <>
          <Text style={styles.hint}>Choose the rails for your custom build.</Text>
          {CUSTOM_RAIL_BRANDS.map((item) => (
            <Pressable key={item} onPress={() => onBrandChange(item)} style={styles.row}>
              <Text style={styles.name}>{item}</Text>
              <CaretRightIcon size={17} color={theme.neutral.textMuted} />
            </Pressable>
          ))}
        </>
      ) : (
        <>
          <Pressable onPress={() => onBrandChange(null)} style={styles.back}>
            <ArrowLeftIcon size={16} color={theme.palette.cyan.color} />
            <Text style={styles.backText}>All rails</Text>
          </Pressable>
          {CUSTOM_RAIL_OPTIONS.filter((option) => option.brand === brand).map((option) => (
            <Pressable key={option.id} onPress={() => onSelect(option.railId)} style={styles.row}>
              <BoardModelPreview
                railId={option.railId}
                railColorId={railColorId}
                size={60}
                rollDegrees={0}
              />
              <Text style={styles.name}>{option.name}</Text>
              {option.railId === railId ? (
                <CheckIcon size={17} color={theme.palette.cyan.color} />
              ) : null}
            </Pressable>
          ))}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: 8, paddingHorizontal: 16, paddingBottom: 18 },
  hint: { color: theme.neutral.textSecondary, fontSize: 14, paddingBottom: 8 },
  row: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 12,
    backgroundColor: theme.neutral.surface,
  },
  name: { flex: 1, fontSize: 15, fontWeight: '700', color: theme.neutral.textPrimary },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  backText: { color: theme.palette.cyan.color, fontSize: 13, fontWeight: '700' },
})
