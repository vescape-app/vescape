import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState, type ReactNode } from 'react'

import {
  ArrowsDownUpIcon,
  BroadcastIcon,
  ChartLineUpIcon,
  FadersIcon,
  GaugeIcon,
  JoystickIcon,
  MapPinIcon,
  StackIcon,
  XIcon,
} from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { CollapsibleWidget } from '@/components/widgets/CollapsibleWidget'
import { Placeholder } from '@/components/base/Placeholder'
import { CanvasWidget } from '@/components/widgets/CanvasWidget'
import { DialWidget } from '@/modules/tune/components/DialWidget'
import { InputWidget } from '@/components/widgets/InputWidget'
import { LinkWidget } from '@/components/widgets/LinkWidget'
import { SelectWidget } from '@/components/widgets/SelectWidget'
import { StepperWidget } from '@/components/widgets/StepperWidget'
import { SwitchWidget } from '@/components/widgets/SwitchWidget'
import { FloatingSheet } from '@/components/overlays/AnchoredSheet'
import { useTriggerRef } from '@/components/overlays/measureTrigger'
import { IconHero } from '@/components/settings/IconHero'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { theme } from '@/constants/theme'

/** A horizontal grid row — each `Cell` child takes an equal fraction of the width. */
function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>
}

function Cell({ children }: { children?: ReactNode }) {
  return <View style={styles.cell}>{children}</View>
}

function SizeLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sizeLabel}>{children}</Text>
}

function InputWidgetShowcase() {
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

function LinkWidgetShowcase() {
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

function SelectWidgetShowcase() {
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

function StepperWidgetShowcase() {
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

function CollapsibleWidgetShowcase() {
  return (
    <ShowcaseCard name="CollapsibleWidget">
      <SizeLabel>collapsed by default</SizeLabel>
      <CollapsibleWidget
        icon={JoystickIcon}
        title="Tilt"
        description="Adjust board tilt from your phone in real time."
        accent={theme.palette.sky.color}
        expandedHeight={130}
      >
        <Placeholder
          icon={JoystickIcon}
          description="Expanded control content goes here."
          style={styles.collapsiblePreview}
        />
      </CollapsibleWidget>
      <SizeLabel>expanded by default</SizeLabel>
      <CollapsibleWidget
        icon={JoystickIcon}
        title="Tilt"
        description="Adjust board tilt from your phone in real time."
        accent={theme.palette.sky.color}
        defaultExpanded
        expandedHeight={130}
      >
        <Placeholder
          icon={JoystickIcon}
          description="Expanded control content goes here."
          style={styles.collapsiblePreview}
        />
      </CollapsibleWidget>
    </ShowcaseCard>
  )
}

function SwitchWidgetShowcase() {
  const [full, setFull] = useState(true)
  const [a, setA] = useState(false)
  const [b, setB] = useState(true)
  const [c, setC] = useState(false)

  return (
    <ShowcaseCard name="SwitchWidget">
      <SizeLabel>full (1×4)</SizeLabel>
      <SwitchWidget
        icon={BroadcastIcon}
        accent={theme.palette.groupRide.color}
        label="Broadcast presence"
        hint="Share your live position with the group"
        value={full}
        onValueChange={setFull}
      />
      <SizeLabel>half (1×2)</SizeLabel>
      <Row>
        <Cell>
          <SwitchWidget label="Haptics" value={a} size="half" onValueChange={setA} />
        </Cell>
        <Cell>
          <SwitchWidget
            icon={MapPinIcon}
            accent={theme.palette.green.color}
            label="GPS"
            value={b}
            size="half"
            onValueChange={setB}
          />
        </Cell>
      </Row>
      <SizeLabel>square (1×1)</SizeLabel>
      <Row>
        <Cell>
          <SwitchWidget
            icon={BroadcastIcon}
            accent={theme.palette.groupRide.color}
            label="Live"
            value={c}
            size="square"
            onValueChange={setC}
          />
        </Cell>
        <Cell />
        <Cell />
        <Cell />
      </Row>
    </ShowcaseCard>
  )
}

function DialWidgetShowcase() {
  const [full, setFull] = useState(80)
  const [half, setHalf] = useState(6)

  return (
    <ShowcaseCard name="DialWidget">
      <SizeLabel>full (1×4)</SizeLabel>
      <DialWidget
        label="Alert threshold"
        accent={theme.palette.orange.color}
        value={full}
        previousValue={65}
        min={0}
        max={100}
        step={1}
        unit="%"
        onValueChange={setFull}
      />
      <SizeLabel>half (1×2)</SizeLabel>
      <Row>
        <Cell>
          <DialWidget
            label="Gain"
            value={half}
            min={0}
            max={10}
            step={0.5}
            size="half"
            onValueChange={setHalf}
          />
        </Cell>
        <Cell />
      </Row>
      <SizeLabel>square (1×1)</SizeLabel>
      <Row>
        <Cell>
          <DialWidget
            label="Gain"
            value={half}
            min={0}
            max={10}
            step={0.5}
            unit="x"
            size="square"
            help="Tap the tile to scrub the value in a popover editor."
            onValueChange={setHalf}
          />
        </Cell>
        <Cell />
        <Cell />
        <Cell />
      </Row>
    </ShowcaseCard>
  )
}

function CanvasWidgetShowcase() {
  const [active, setActive] = useState(false)

  return (
    <ShowcaseCard name="CanvasWidget">
      <SizeLabel>full (1×4)</SizeLabel>
      <CanvasWidget
        icon={BroadcastIcon}
        title="Group Ride"
        accent={theme.palette.groupRide.color}
        surface="secondary"
        active={active}
        height={200}
        action={
          active ? null : (
            <Pressable onPress={() => setActive(true)} hitSlop={10} accessibilityLabel="Dismiss">
              <XIcon size={18} color={theme.neutral.textSecondary} weight="bold" />
            </Pressable>
          )
        }
        footer={
          <Button
            label={active ? 'Leave' : 'Create'}
            variant={active ? 'secondary' : 'primary'}
            onPress={() => setActive((v) => !v)}
            style={styles.fill}
          />
        }
      >
        {active ? (
          <>
            <Text style={styles.name}>Sunset cruise</Text>
            <Text style={styles.meta}>4 riders · live now</Text>
          </>
        ) : (
          <Placeholder icon={BroadcastIcon} description="No group rides near you right now." />
        )}
      </CanvasWidget>
      <SizeLabel>half (1×2)</SizeLabel>
      <Row>
        <Cell>
          <CanvasWidget
            icon={GaugeIcon}
            title="Top speed"
            accent={theme.palette.sky.color}
            active
            size="half"
            height={120}
          >
            <Text style={styles.name}>42 km/h</Text>
            <Text style={styles.meta}>this ride</Text>
          </CanvasWidget>
        </Cell>
        <Cell />
      </Row>
      <SizeLabel>square (1×1)</SizeLabel>
      <Row>
        <Cell>
          <CanvasWidget
            icon={GaugeIcon}
            title="Top speed"
            accent={theme.palette.sky.color}
            active
            size="square"
          >
            <Text style={styles.squareValue}>42</Text>
            <Text style={styles.meta}>km/h</Text>
          </CanvasWidget>
        </Cell>
        <Cell />
        <Cell />
        <Cell />
      </Row>
    </ShowcaseCard>
  )
}

export default function WidgetsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={StackIcon}
          description="Reusable dashboard widgets with full, half and square footprints where each control supports them."
        />
        <InputWidgetShowcase />
        <LinkWidgetShowcase />
        <SelectWidgetShowcase />
        <StepperWidgetShowcase />
        <CollapsibleWidgetShowcase />
        <SwitchWidgetShowcase />
        <DialWidgetShowcase />
        <CanvasWidgetShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  cell: { flex: 1 },
  sizeLabel: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  fill: { flex: 1 },
  name: { color: theme.neutral.textPrimary, fontSize: 17, fontWeight: '700' },
  squareValue: {
    color: theme.neutral.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  meta: { color: theme.neutral.textSecondary, fontSize: 13 },
  collapsiblePreview: { minHeight: 120 },
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
