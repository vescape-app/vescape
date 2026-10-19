import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Stack } from 'expo-router'
import { Input } from '@/components/forms/Input'
import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import {
  DEFAULT_RING_ANCHORS,
  validateRingAnchors,
  type RingAnchors,
  type RingCalibrationField,
} from '../lib/ringCalibration'
import { useRingCalibrationStore } from '../store/ringCalibrationStore'

const fields = Object.keys(DEFAULT_RING_ANCHORS) as RingCalibrationField[]
const toText = (anchors: RingAnchors) =>
  Object.fromEntries(fields.map((id) => [id, anchors[id].map(String)])) as Record<
    RingCalibrationField,
    string[]
  >

export function RingCalibrationScreen() {
  const neutral = useResolvedNeutralColors()
  const { anchors, apply, reset } = useRingCalibrationStore()
  const [inputs, setInputs] = useState(() => toText(anchors))
  const candidate = Object.fromEntries(
    fields.map((id) => [
      id,
      inputs[id].map((text) => (text.trim() === '' ? NaN : Number(text.replace(',', '.')))),
    ]),
  ) as RingAnchors
  const error = validateRingAnchors(candidate)
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: neutral.bg }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'Rings calibration' }} />
      <Text>
        Temporary Rings calibration. Raw Refloat values at Rings 0 / 5 / 10, linearly interpolated.
        Apply updates Rings mappings immediately. Existing profiles stay unchanged. Values reset
        when the app restarts.
      </Text>
      <Text>
        Braking stays fixed at 5 / 2.5 / 0. Turning stays fixed at -15 / 0 / 15 (Rings -5 / 0 / +5).
        Preset names and values are experimental; fast ATR means high-speed Response Boost only.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0, 5, 10].map((value) => (
          <Text key={value} style={{ flex: 1, textAlign: 'center' }}>
            Rings {value}
          </Text>
        ))}
      </View>
      {fields.map((id) => (
        <View key={id} style={{ gap: 6 }}>
          <Text>{id}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {inputs[id].map((value, index) => (
              <Input
                key={index}
                accessibilityLabel={`${id} at Rings ${index * 5}`}
                value={value}
                keyboardType="decimal-pad"
                selectTextOnFocus
                onChangeText={(text) =>
                  setInputs((current) => ({
                    ...current,
                    [id]: current[id].map((v, i) => (i === index ? text : v)),
                  }))
                }
                style={{
                  flex: 1,
                  minHeight: 48,
                }}
              />
            ))}
          </View>
        </View>
      ))}
      {error ? <Text style={{ color: theme.status.error.text }}>{error}</Text> : null}
      <Button label="Apply calibration" disabled={error != null} onPress={() => apply(candidate)} />
      <Button
        label="Reset calibration"
        variant="secondary"
        onPress={() => {
          reset()
          setInputs(toText(DEFAULT_RING_ANCHORS))
        }}
      />
    </ScrollView>
  )
}
