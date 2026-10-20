// THROWAWAY: local profile copies and edit history. Never touches the native tune store.
import { useState } from 'react'
import type { TuneProfileMetadataValue } from '@/modules/tune/components/TuneProfileMetadataModal'
import { GROUPS, TUNE_PRESETS } from './tuneRingControls'

export interface PrototypeProfile extends TuneProfileMetadataValue {
  id: string
  values: number[][]
}
export interface PrototypeHistoryEntry {
  profileId: string
  time: string
  changes: string[]
}
const clone = (values: number[][]) => values.map((group) => [...group])
export function usePrototypeProfiles(values: number[][], onSelect: (values: number[][]) => void) {
  const [activeId, setActiveId] = useState('main')
  const [revision, setRevision] = useState(0)
  const [profiles, setProfiles] = useState<PrototypeProfile[]>(() => [
    {
      id: 'main',
      name: 'Main',
      icon: 'sliders-horizontal',
      color: 'purple',
      values: clone(values),
    },
    {
      id: 'street',
      name: 'Street',
      icon: 'road-horizon',
      color: 'cyan',
      values: clone(TUNE_PRESETS[1].values),
    },
    {
      id: 'trail',
      name: 'Trail',
      icon: 'mountains',
      color: 'orange',
      values: clone(TUNE_PRESETS[0].values),
    },
  ])
  const [history, setHistory] = useState<PrototypeHistoryEntry[]>([])
  const activeProfile = profiles.find((profile) => profile.id === activeId)!
  const savedValues = activeProfile.values
  const changedCount = values.reduce(
    (total, group, page) =>
      total + group.slice(0, 3).filter((value, index) => value !== savedValues[page][index]).length,
    0,
  )
  const dirty = changedCount > 0
  const save = () => {
    if (!dirty) return
    const changes = values.flatMap((group, page) =>
      group
        .slice(0, 3)
        .flatMap((value, index) =>
          value === savedValues[page][index]
            ? []
            : [
                `${GROUPS[page].labels[index]}: ${(savedValues[page][index] / 10).toFixed(1)} → ${(value / 10).toFixed(1)}`,
              ],
        ),
    )
    setProfiles((current) =>
      current.map((profile) =>
        profile.id === activeId ? { ...profile, values: clone(values) } : profile,
      ),
    )
    setHistory((current) =>
      [
        {
          profileId: activeId,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          changes,
        },
        ...current,
      ].slice(0, 50),
    )
  }
  const discard = () => {
    onSelect(clone(savedValues))
    setRevision((current) => current + 1)
  }
  const select = (id: string) => {
    const profile = profiles.find((item) => item.id === id)
    if (!profile || id === activeId) return
    setActiveId(id)
    onSelect(clone(profile.values))
  }
  const create = (metadata: TuneProfileMetadataValue) => {
    const id = `prototype-${Date.now()}`
    setProfiles((current) => [...current, { ...metadata, id, values: clone(values) }])
    setActiveId(id)
  }
  return {
    activeId,
    revision,
    activeProfile,
    savedValues,
    dirty,
    changedCount,
    save,
    discard,
    profiles,
    history: history.filter((entry) => entry.profileId === activeId),
    select,
    create,
  }
}
