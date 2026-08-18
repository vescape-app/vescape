import React, { type ReactNode } from 'react'
import { Box, Text } from 'ink'

export interface MenuItem {
  key: string
  label: string
  detail?: string
}

/** Arrow/Enter navigation is the only input model in this CLI; no letter shortcuts. */
export function Menu({ items, index }: { items: readonly MenuItem[]; index: number }) {
  return (
    <Box flexDirection="column">
      {items.map((item, itemIndex) => {
        const selected = itemIndex === index
        return (
          <Text key={item.key} color={selected ? 'cyan' : undefined} bold={selected}>
            {selected ? '❯ ' : '  '}
            {item.label}
            {item.detail ? <Text dimColor> {item.detail}</Text> : null}
          </Text>
        )
      })}
    </Box>
  )
}

export function Hint({ children }: { children: ReactNode }) {
  return <Text dimColor>{children}</Text>
}

export function Rule() {
  return <Text dimColor>{'─'.repeat(72)}</Text>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Text>
      <Text dimColor>{label.padEnd(20)}</Text>
      {children}
    </Text>
  )
}

export interface ConfirmField {
  label: string
  value: ReactNode
}

/**
 * Single confirm presentation for every mutating flow: title, the exact facts the workflow will
 * act on, then a two-item menu. Confirm comes first so Enter continues; callers that guard a
 * public-facing mutation start the selection on Cancel instead.
 */
export function Confirm({
  title,
  fields,
  note,
  confirmLabel,
  index,
}: {
  title: string
  fields: readonly ConfirmField[]
  note?: string
  confirmLabel: string
  index: number
}) {
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {fields.map((field) => (
          <Field key={field.label} label={field.label}>
            {field.value}
          </Field>
        ))}
      </Box>
      {note ? <Hint>{note}</Hint> : null}
      <Box flexDirection="column" marginTop={1}>
        <Menu
          items={[
            { key: 'confirm', label: confirmLabel },
            { key: 'cancel', label: 'Cancel' },
          ]}
          index={index}
        />
      </Box>
      <Hint>↑/↓ · Enter</Hint>
    </Box>
  )
}
