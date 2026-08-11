import { ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useMemo, useState } from 'react'

import { ListIcon } from 'phosphor-react-native'
import { ColorPicker } from '@/components/forms/ColorPicker'
import { Dropdown, useTriggerRef } from '@/components/forms/Dropdown'
import { IconHero } from '@/components/settings/IconHero'
import { Input } from '@/components/forms/Input'
import { Select, type SelectOption } from '@/components/forms/Select'
import { SoundPicker } from '@/components/forms/SoundPicker'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { OpenButton } from '@/components/dev/ShowcaseControls'

import { riderColorOptions } from '@/modules/group-ride/constants/riderColors'
import { theme } from '@/constants/theme'
import type { AlertSound } from 'vescape-core'

function SelectShowcase() {
  const options: SelectOption[] = useMemo(
    () => [
      { label: 'Speed', value: 'speed' },
      { label: 'Duty Cycle', value: 'duty' },
      { label: 'Current', value: 'current' },
      { label: 'Temperature', value: 'temperature' },
    ],
    [],
  )
  const [value, setValue] = useState('speed')

  return (
    <ShowcaseCard name="Select">
      <Select options={options} value={value} onChange={setValue} placeholder="Choose metric…" />
    </ShowcaseCard>
  )
}

function InputShowcase() {
  const [text, setText] = useState('')
  return (
    <ShowcaseCard name="Input">
      <Input value={text} onChangeText={setText} placeholder="Type something…" />
    </ShowcaseCard>
  )
}

function TextareaShowcase() {
  const [text, setText] = useState('')
  return (
    <ShowcaseCard name="Textarea (Input multiline)">
      <Input
        value={text}
        onChangeText={setText}
        placeholder="Multi-line text…"
        multiline
        numberOfLines={3}
        textAlignVertical="top"
        style={{ minHeight: 84, paddingTop: 12 }}
      />
    </ShowcaseCard>
  )
}

function DropdownShowcase() {
  const [visible, setVisible] = useState(false)
  const triggerRef = useTriggerRef()

  return (
    <ShowcaseCard
      name="Dropdown"
      controls={<OpenButton label="Open Dropdown" onPress={() => setVisible(true)} />}
    >
      <View ref={triggerRef} style={{ alignSelf: 'center' }}>
        <Text style={styles.previewHint}>Tap &quot;Open Dropdown&quot; below</Text>
      </View>
      <Dropdown
        visible={visible}
        triggerRef={triggerRef}
        onClose={() => setVisible(false)}
        minWidth={180}
      >
        <View style={{ padding: 12, gap: 8 }}>
          <Text style={styles.dropdownItem}>Profile</Text>
          <Text style={styles.dropdownItem}>Settings</Text>
          <Text style={[styles.dropdownItem, { color: theme.status.error.color }]}>Logout</Text>
        </View>
      </Dropdown>
    </ShowcaseCard>
  )
}

function SoundPickerShowcase() {
  const mockPresets: AlertSound[] = useMemo(
    () => [
      { name: 'Chime', uri: 'chime', category: 'single' },
      { name: 'Alert', uri: 'alert', category: 'single' },
      { name: 'Beep', uri: 'beep', category: 'geiger' },
      { name: 'Pulse', uri: 'pulse', category: 'geiger' },
    ],
    [],
  )
  const [selected, setSelected] = useState('chime')

  return (
    <ShowcaseCard name="SoundPicker">
      <SoundPicker presets={mockPresets} selected={selected} onSelect={setSelected} />
    </ShowcaseCard>
  )
}

function ColorPickerShowcase() {
  const [color, setColor] = useState<string | null>(riderColorOptions[0] ?? null)
  return (
    <ShowcaseCard name="ColorPicker">
      <ColorPicker value={color} colors={riderColorOptions} onChange={setColor} />
    </ShowcaseCard>
  )
}

export default function FormsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero icon={ListIcon} description="Select, Dropdown, ColorPicker, SoundPicker." />
        <InputShowcase />
        <TextareaShowcase />
        <SelectShowcase />
        <DropdownShowcase />
        <ColorPickerShowcase />
        <SoundPickerShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  previewHint: { color: theme.palette.slate.textDim, fontSize: 12, fontStyle: 'italic' },
  dropdownItem: {
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 4,
  },
})
