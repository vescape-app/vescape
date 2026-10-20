import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { useState } from 'react'
import { Modal } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button } from '@/components/base/Button'
import type { TuneProfile } from 'vescape-core'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ValueRow } from '@/components/dev/ShowcaseControls'
import { RingsEditor } from '@/modules/tune/components/RingsEditor'
import { TuneEditorFooter } from '@/modules/tune/components/TuneEditorFooter'
import { DEFAULT_RING_ANCHORS } from '@/modules/tune/lib/ringCalibration'
import { ringSectionPatch, type RingFields } from '@/modules/tune/lib/ringModel'
import { useRingMappingNoticeStore } from '@/modules/tune/store/ringMappingNoticeStore'
import { useTuneModals } from '@/modules/tune/hooks/useTuneModals'

const initial = Object.assign(
  {},
  ...[0, 1, 2].map((section) => ringSectionPatch(DEFAULT_RING_ANCHORS, section, [5, 5, 5])),
) as RingFields
const profile: TuneProfile = {
  id: 'rings-showcase',
  boardId: 'showcase',
  refloatBaseVersion: '1.2',
  name: 'Long tune name for small screen checks',
  icon: 'sliders-horizontal',
  color: 'purple',
  fields: initial,
  createdAt: 0,
  updatedAt: 0,
}

/** Isolated UI fixture: no native profile writes or firmware commands. */
export function RingsEditorShowcase() {
  const neutral = useResolvedNeutralColors()
  const [visible, setVisible] = useState(false)
  const [profileColor, setProfileColor] = useState('purple')
  const previewProfile = { ...profile, color: profileColor }
  const [projection, setProjection] = useState('mapped')
  const [fields, setFields] = useState(initial)
  const [savedFields, setSavedFields] = useState(initial)
  const [connection, setConnection] = useState('offline')
  const [boardState, setBoardState] = useState<'match' | 'different' | 'unknown'>('unknown')
  const [lastAction, setLastAction] = useState('None')
  const modals = useTuneModals(profile, [], {}, [], 'showcase')
  const dirtyCount = Object.keys(fields).filter((id) => fields[id] !== savedFields[id]).length
  return (
    <ShowcaseCard
      name="Rings production editor"
      controls={
        <>
          <ChipRow
            label="Tune color"
            options={['purple', 'cyan', 'orange']}
            selected={profileColor}
            onSelect={setProfileColor}
          />
          <Button
            label="Reset mapping notice"
            onPress={() => useRingMappingNoticeStore.setState({ owner: null, acknowledged: false })}
          />
          <ValueRow label="changed raw fields" value={dirtyCount} />
          <ValueRow label="last action (fixture only)" value={lastAction} />
          <ChipRow
            label="projection"
            options={['mapped', 'custom', 'missing']}
            selected={projection}
            onSelect={(value) => {
              setProjection(value)
              setSavedFields(initial)
              setFields(
                value === 'custom'
                  ? { ...initial, mahony_kp_roll: 2.7 }
                  : value === 'missing'
                    ? { ...initial, kp2: null }
                    : initial,
              )
            }}
          />
          <ChipRow
            label="connection (preview only)"
            options={['offline', 'connected']}
            selected={connection}
            onSelect={setConnection}
          />
          <ChipRow
            label="board badge"
            options={['match', 'different', 'unknown']}
            selected={boardState}
            onSelect={(value) => setBoardState(value as typeof boardState)}
          />
        </>
      }
    >
      <Button label="Open Rings editor" onPress={() => setVisible(true)} />
      <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: neutral.bg }}>
          <Button
            label="Close Rings editor"
            variant="secondary"
            onPress={() => setVisible(false)}
          />
          <RingsEditor
            active={visible}
            fields={fields}
            savedFields={savedFields}
            onPatch={(patch) => setFields((current) => ({ ...current, ...patch }))}
          />
          <TuneEditorFooter
            selector={{
              activeProfile: { ...previewProfile, fields: savedFields },
              profiles: [previewProfile],
              modals,
              onSelectProfile: () => undefined,
            }}
            dirtyCount={dirtyCount}
            saving={false}
            busy={false}
            canRead={false}
            canSend={false}
            boardState={boardState}
            boardConnected={connection === 'connected'}
            onSave={() => {
              setSavedFields(fields)
              setLastAction('Save')
            }}
            onDiscard={() => {
              setFields(savedFields)
              setLastAction('Discard')
            }}
            onRead={() => undefined}
            onSend={() => undefined}
          />
        </SafeAreaView>
      </Modal>
    </ShowcaseCard>
  )
}
