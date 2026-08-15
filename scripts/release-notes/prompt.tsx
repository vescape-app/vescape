import React, { useState } from 'react'
import { Box, render, Text, useApp, useInput } from 'ink'

interface SelectOption<T extends string> {
  value: T
  label: string
  shortcut: string
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
  useInput((input, key) => {
    const shortcut = options.findIndex((option) => option.shortcut === input.toLowerCase())
    if (key.upArrow || input.toLowerCase() === 'k')
      setIndex((value) => (value - 1 + options.length) % options.length)
    else if (key.downArrow || input.toLowerCase() === 'j')
      setIndex((value) => (value + 1) % options.length)
    else if (key.return || shortcut >= 0) {
      finish(options[shortcut >= 0 ? shortcut : index].value)
      exit()
    }
  })
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {options.map((option, optionIndex) => {
        const selected = optionIndex === index
        return (
          <Text key={option.value} color={selected ? 'cyan' : undefined} bold={selected}>
            {selected ? '◆ ' : '  '}
            {option.label} <Text dimColor>({option.shortcut.toUpperCase()})</Text>
          </Text>
        )
      })}
      <Text dimColor>↑/↓ or j/k · Enter selects · shortcuts work directly</Text>
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
  return result ?? null
}
