import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { useState } from 'react'

import {
  ArrowsDownUpIcon,
  BroadcastIcon,
  ChartLineUpIcon,
  FadersIcon,
  FootprintsIcon,
  GaugeIcon,
  MapPinIcon,
} from 'phosphor-react-native'
import { InputWidget } from '@/components/widgets/InputWidget'
import { LinkWidget } from '@/components/widgets/LinkWidget'
import { SelectWidget } from '@/components/widgets/SelectWidget'
import { StepperWidget } from '@/components/widgets/StepperWidget'
import { FloatingSheet } from '@/components/overlays/AnchoredSheet'
import { useTriggerRef } from '@/components/overlays/measureTrigger'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { theme } from '@/constants/theme'
import { Cell, Row, SizeLabel } from '@/screens/showcase/widgets/WidgetGrid'

/** A horizontal grid row — each `Cell` child takes an equal fraction of the width. */
export function InputWidgetShowcase() {
  const [full, setFull] = useState<string | null>('Kacper')
  const [half, setHalf] = useState<string | null>('Sunset')
  const [square, setSquare] = useState<string | null>('42')

  return (
    <ShowcaseCard name="InputWidget">
      <SizeLabel>full (1×4)</SizeLabel>
      <InputWidget
        label="Your name"
        value={full}
        placeholder="Add a display name"
        maxLength={32}
        onCommit={setFull}
      />
      <SizeLabel>half (1×2)</SizeLabel>
      <Row>
        <Cell>
          <InputWidget label="Crew" value={half} size="half" onCommit={setHalf} />
        </Cell>
        <Cell />
      </Row>
      <SizeLabel>square (1×1)</SizeLabel>
      <Row>
        <Cell>
          <InputWidget label="Bib" value={square} size="square" onCommit={setSquare} />
        </Cell>
        <Cell />
        <Cell />
        <Cell />
      </Row>
    </ShowcaseCard>
  )
}

export function LinkWidgetShowcase() {
  return (
    <ShowcaseCard name="LinkWidget">
      <SizeLabel>full (1×4)</SizeLabel>
      <LinkWidget
        icon={ChartLineUpIcon}
        accent={theme.palette.sky.color}
        label="Profile stats"
        hint="All-time & monthly riding totals"
        onPress={() => {}}
      />
      <SizeLabel>half (1×2)</SizeLabel>
      <Row>
        <Cell>
          <LinkWidget
            icon={ChartLineUpIcon}
            accent={theme.palette.sky.color}
            label="Stats"
            size="half"
            onPress={() => {}}
          />
        </Cell>
        <Cell>
          <LinkWidget
            icon={MapPinIcon}
            accent={theme.palette.green.color}
            label="Routes"
            size="half"
            onPress={() => {}}
          />
        </Cell>
      </Row>
      <SizeLabel>square (1×1)</SizeLabel>
      <Row>
        <Cell>
          <LinkWidget
            icon={ChartLineUpIcon}
            accent={theme.palette.sky.color}
            label="Stats"
            size="square"
            onPress={() => {}}
          />
        </Cell>
        <Cell>
          <LinkWidget
            icon={MapPinIcon}
            accent={theme.palette.green.color}
            label="Routes"
            size="square"
            onPress={() => {}}
          />
        </Cell>
        <Cell>
          <LinkWidget
            icon={BroadcastIcon}
            accent={theme.palette.groupRide.color}
            label="Group"
            size="square"
            onPress={() => {}}
          />
        </Cell>
        <Cell />
      </Row>
    </ShowcaseCard>
  )
}

export function SelectWidgetShowcase() {
  const [value, setValue] = useState('Street')
  const [open, setOpen] = useState(false)
  const triggerRef = useTriggerRef()
  const options = ['Street', 'Trail', 'Trick']

  return (
    <ShowcaseCard name="SelectWidget">
      <SizeLabel>full (1×4)</SizeLabel>
      <View ref={triggerRef} collapsable={false}>
        <SelectWidget
          icon={FadersIcon}
          selectIcon={GaugeIcon}
          badgeIcon={FootprintsIcon}
          badgeAccent={theme.palette.green.color}
          label="Tunes"
          value={value}
          description="Pick how your board should feel."
          accent={theme.palette.purple.color}
          selectAccent={theme.palette.green.color}
          selectBackground={theme.palette.green.bg}
          selectBorder={theme.palette.green.border}
          selectOpen={open}
          onPress={() => {}}
          onSelectPress={() => setOpen(true)}
        />
      </View>
      <FloatingSheet
        visible={open}
        triggerRef={triggerRef}
        matchTriggerWidth={false}
        minWidth={220}
        onClose={() => setOpen(false)}
      >
        <View style={styles.optionList}>
          {options.map((option) => (
            <Pressable
              key={option}
              style={[styles.optionRow, option === value && styles.optionRowActive]}
              onPress={() => {
                setValue(option)
                setOpen(false)
              }}
            >
              <Text style={[styles.optionText, option === value && styles.optionTextActive]}>
                {option}
              </Text>
            </Pressable>
          ))}
        </View>
      </FloatingSheet>
    </ShowcaseCard>
  )
}

export function StepperWidgetShowcase() {
  return (
    <ShowcaseCard name="StepperWidget">
      <SizeLabel>full (1×4)</SizeLabel>
      <StepperWidget
        icon={ArrowsDownUpIcon}
        label="Move board"
        accent={theme.palette.cyan.color}
        onPrevious={() => {}}
        onNext={() => {}}
      />
      <SizeLabel>disabled</SizeLabel>
      <StepperWidget
        icon={ArrowsDownUpIcon}
        label="Move board"
        accent={theme.palette.cyan.color}
        disabled
        onPrevious={() => {}}
        onNext={() => {}}
      />
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  optionList: { gap: 6 },
  optionRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  optionRowActive: {
    backgroundColor: theme.neutral.surfaceDeep,
  },
  optionText: {
    color: theme.neutral.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  optionTextActive: {
    color: theme.palette.sky.text,
  },
})
