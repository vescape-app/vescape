import { useState } from 'react'
import { FlatList, Pressable, StyleSheet, View } from 'react-native'
import { CaretDownIcon, CheckIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { inputBase } from '@/components/forms/Input'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { theme } from '@/constants/theme'
import { useResolvedControlColors } from '@/hooks/useTheme'
import {
  COUNTRIES,
  countryByCode,
  countryFlag,
  type Country,
} from '@/modules/profile/lib/countries'

const ROW_HEIGHT = 48
const NO_COUNTRY: Country = { code: '', name: 'No country' }
const ROWS = [NO_COUNTRY, ...COUNTRIES]

export function CountryPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const control = useResolvedControlColors()
  const country = countryByCode(value)
  const selectedIndex = Math.max(
    0,
    ROWS.findIndex((row) => row.code === (country?.code ?? '')),
  )

  return (
    <>
      <Pressable
        style={[
          styles.trigger,
          { backgroundColor: control.background, borderColor: control.border },
        ]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Country, ${country?.name ?? 'none'}`}
      >
        <Text style={styles.flag}>{country ? countryFlag(country.code) : '🏳️'}</Text>
        <Text
          numberOfLines={1}
          style={[styles.triggerText, { color: country ? control.text : control.textMuted }]}
        >
          {country?.name ?? 'No country'}
        </Text>
        <CaretDownIcon size={14} color={control.textMuted} weight="bold" />
      </Pressable>

      <FadeCardModal
        visible={open}
        onDismiss={() => setOpen(false)}
        title="Country"
        showClose
        scrollable={false}
      >
        <FlatList
          style={styles.list}
          data={ROWS}
          keyExtractor={(row) => row.code || 'none'}
          initialScrollIndex={Math.max(0, selectedIndex - 3)}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          renderItem={({ item, index }) => {
            const selected = index === selectedIndex
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  selected && styles.rowSelected,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => {
                  onChange(item.code)
                  setOpen(false)
                }}
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
              >
                <Text style={styles.flag}>{item.code ? countryFlag(item.code) : '🏳️'}</Text>
                <Text
                  numberOfLines={1}
                  style={[styles.rowText, selected && styles.rowTextSelected]}
                >
                  {item.name}
                </Text>
                {selected ? (
                  <CheckIcon size={14} color={theme.palette.sky.color} weight="bold" />
                ) : (
                  <View style={styles.checkSpace} />
                )}
              </Pressable>
            )
          }}
        />
      </FadeCardModal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    ...inputBase,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  triggerText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  flag: {
    fontSize: 18,
  },
  list: {
    maxHeight: 420,
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  rowSelected: {
    backgroundColor: theme.neutral.surfaceDeep,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowText: {
    flex: 1,
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '500',
  },
  rowTextSelected: {
    fontWeight: '700',
  },
  checkSpace: {
    width: 14,
  },
})
