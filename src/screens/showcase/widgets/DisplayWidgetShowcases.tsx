import { Pressable, StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { useState } from 'react'

import { BroadcastIcon, GaugeIcon, JoystickIcon, MapPinIcon, XIcon } from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { CollapsibleWidget } from '@/components/widgets/CollapsibleWidget'
import { Placeholder } from '@/components/base/Placeholder'
import { CanvasWidget } from '@/components/widgets/CanvasWidget'
import { DialWidget } from '@/modules/tune/components/DialWidget'
import { SwitchWidget } from '@/components/widgets/SwitchWidget'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { theme } from '@/constants/theme'
import { Cell, Row, SizeLabel } from '@/screens/showcase/widgets/WidgetGrid'

/** A horizontal grid row — each `Cell` child takes an equal fraction of the width. */
export function CollapsibleWidgetShowcase() {
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

export function SwitchWidgetShowcase() {
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

export function DialWidgetShowcase() {
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

export function CanvasWidgetShowcase() {
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

const styles = StyleSheet.create({
  collapsiblePreview: { minHeight: 120 },
  fill: { flex: 1 },
  meta: { color: theme.neutral.textSecondary, fontSize: 13 },
  name: { color: theme.neutral.textPrimary, fontSize: 17, fontWeight: '700' },
  squareValue: {
    color: theme.neutral.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
})
