import React, { useState } from 'react'
import { Box, render, Text, useApp, useInput } from 'ink'

import { Hint, Menu } from '../release/ui'

interface SelectOption<T extends string> {
  value: T
  label: string
}

function SelectPrompt<T extends string>({
  title,
  options,
  finish,
}: {
  title: string
  options: ReadonlyArray<SelectOption<T>>
  finish: (value: T) => void
}) {
  const { exit } = useApp()
  const [index, setIndex] = useState(0)
  useInput((_input, key) => {
    if (key.upArrow) setIndex((value) => (value - 1 + options.length) % options.length)
    else if (key.downArrow) setIndex((value) => (value + 1) % options.length)
    else if (key.return) {
      finish(options[index].value)
      exit()
    } else if (key.escape) {
      exit()
    }
  })
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Menu
        items={options.map((option) => ({ key: option.value, label: option.label }))}
        index={index}
      />
      <Hint>↑/↓ · Enter selects · Esc cancels</Hint>
    </Box>
  )
}

export async function selectPrompt<T extends string>(
  title: string,
  options: ReadonlyArray<SelectOption<T>>,
): Promise<T> {
  let selected: T | undefined
  const instance = render(
    <SelectPrompt title={title} options={options} finish={(value) => (selected = value)} />,
  )
  await instance.waitUntilExit()
  instance.unmount()
  if (selected === undefined) throw new Error('Selection cancelled')
  return selected
}

function TextPrompt({ title, finish }: { title: string; finish: (value: string | null) => void }) {
  const { exit } = useApp()
  const [value, setValue] = useState('')
  useInput((input, key) => {
    if (key.return && value.trim()) {
      finish(value.trim())
      exit()
    } else if (key.escape) {
      finish(null)
      exit()
    } else if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1))
    } else if (input && !key.ctrl && !key.meta) {
      setValue((current) => current + input)
    }
  })
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Text>
        › <Text color="cyan">{value || ' '}</Text>
      </Text>
      <Text dimColor>Enter submits · Esc cancels</Text>
    </Box>
  )
}

export async function textPrompt(title: string): Promise<string | null> {
  let result: string | null | undefined
  const instance = render(<TextPrompt title={title} finish={(value) => (result = value)} />)
  await instance.waitUntilExit()
  instance.unmount()
  return result ?? null
}
