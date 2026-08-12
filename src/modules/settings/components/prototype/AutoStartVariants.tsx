/**
 * PROTOTYPE — throwaway. Round 6: same card as round 5, but adding a board never opens a modal.
 * One linked board  -> plain switch, no list (toggling on arms that board).
 * Two or more       -> switch + inline board picking, expanded in place under the "+".
 * Switched via `?variant=T|U` on /settings/connection. Delete once a winner lands (NOTES.md).
 */
import { useState } from 'react'
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  UIManager,
  View,
} from 'react-native'
import { MinusCircleIcon, PlusIcon, RocketLaunchIcon, WarningIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export type PrototypeBoard = { id: string; name: string; bleId: string }
export type ArmedBoard = { boardId: string; name: string; bleId: string }

export type AutoStartVariantProps = {
  enabled: boolean
  /** Boards currently selected as triggers. */
  armed: ArmedBoard[]
  /** Every linked board (selected or not). */
  linked: PrototypeBoard[]
  cooldownMinutes: number
  busyBoardId: string | null
  masterBusy: boolean
  onToggle: (enabled: boolean) => void
  onAdd: (boardId: string) => void
  onRemove: (boardId: string) => void
  onCooldown: (minutes: number) => void
}

const armedSet = (armed: ArmedBoard[]) => new Set(armed.map((b) => b.boardId))
const ease = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)

function Head({
  on,
  tone,
  hint,
  busy,
  onChange,
}: {
  on: boolean
  tone: 'off' | 'good' | 'warn'
  hint: string
  busy: boolean
  onChange: (v: boolean) => void
}) {
  const color =
    tone === 'good'
      ? theme.palette.green.color
      : tone === 'warn'
        ? theme.palette.amber.color
        : theme.palette.slate.textMuted

  return (
    <View style={s.head}>
      <RocketLaunchIcon size={24} weight="duotone" color={color} />
      <View style={s.headText}>
        <Text style={s.headTitle}>Auto start app</Text>
        <Text style={s.headHint}>{hint}</Text>
      </View>
      <Switch
        value={on}
        disabled={busy}
        onValueChange={onChange}
        trackColor={{ false: theme.palette.slate.border, true: theme.palette.sky.border }}
        thumbColor={on ? theme.palette.sky.color : theme.palette.slate.textMuted}
      />
    </View>
  )
}

/** Toggling on with exactly one linked board arms it silently — no list, no picking. */
const useAutoStartCard = (p: AutoStartVariantProps) => {
  const ids = armedSet(p.armed)
  const candidates = p.linked.filter((b) => !ids.has(b.id))
  const single = p.linked.length === 1
  const empty = p.armed.length === 0
  const tone: 'off' | 'good' | 'warn' = !p.enabled ? 'off' : empty ? 'warn' : 'good'

  const onToggle = (v: boolean) => {
    ease()
    p.onToggle(v)
    if (v && single && empty) p.onAdd(p.linked[0].id)
  }

  const hint = !p.enabled
    ? 'Open the app by itself when a board powers on'
    : p.linked.length === 0
      ? 'Link a board first — nothing to detect'
      : single
        ? `Starts when ${p.linked[0].name} powers on`
        : empty
          ? 'On, but no boards added — nothing will start the app'
          : `Starts when ${p.armed.map((b) => b.name).join(' or ')} powers on`

  return { ids, candidates, single, empty, tone, hint, onToggle }
}

/* ------------------------------------------------------------------ T */
/** T — "+" expands in place: the unarmed boards slide open right under the Add row. */
export function VariantT(p: AutoStartVariantProps) {
  const [open, setOpen] = useState(false)
  const { candidates, empty, tone, hint, onToggle } = useAutoStartCard(p)
  const showList = p.enabled && p.linked.length > 1

  const add = (id: string) => {
    ease()
    setOpen(false)
    p.onAdd(id)
  }

  return (
    <View style={s.section}>
      <View style={[s.card, tone === 'warn' && s.cardWarn]}>
        <Head
          on={p.enabled}
          tone={tone}
          hint={hint}
          busy={p.masterBusy || p.linked.length === 0}
          onChange={onToggle}
        />

        {showList ? (
          <View style={s.body}>
            <Text style={[s.bodyLabel, empty && s.bodyLabelWarn]}>
              {empty ? 'No boards added yet' : 'Starts when these are detected'}
            </Text>

            {p.armed.map((board) => (
              <View key={board.boardId} style={s.row}>
                <RocketLaunchIcon size={18} weight="fill" color={theme.palette.green.color} />
                <View style={s.rowText}>
                  <Text style={s.rowName}>{board.name}</Text>
                  <Text style={s.rowHint}>{board.bleId}</Text>
                </View>
                <Pressable
                  hitSlop={10}
                  onPress={() => {
                    ease()
                    p.onRemove(board.boardId)
                  }}
                >
                  <MinusCircleIcon size={22} weight="fill" color={theme.status.error.color} />
                </Pressable>
              </View>
            ))}

            {candidates.length > 0 ? (
              <>
                <Pressable
                  style={s.row}
                  onPress={() => {
                    ease()
                    setOpen((v) => !v)
                  }}
                >
                  <PlusIcon
                    size={18}
                    weight="bold"
                    color={theme.palette.sky.color}
                    style={open ? s.plusOpen : undefined}
                  />
                  <Text style={s.addText}>{open ? 'Cancel' : 'Add board'}</Text>
                </Pressable>

                {open
                  ? candidates.map((board) => (
                      <Pressable key={board.id} style={s.pick} onPress={() => add(board.id)}>
                        <View style={s.pickText}>
                          <Text style={s.rowName}>{board.name}</Text>
                          <Text style={s.rowHint}>{board.bleId}</Text>
                        </View>
                        <PlusIcon size={16} weight="bold" color={theme.palette.sky.color} />
                      </Pressable>
                    ))
                  : null}
              </>
            ) : null}
          </View>
        ) : null}
      </View>

      {p.enabled && p.linked.length > 1 && empty ? (
        <View style={s.warn}>
          <WarningIcon size={18} weight="fill" color={theme.palette.amber.color} />
          <Text style={s.warnText}>Add at least one board or auto start never fires.</Text>
        </View>
      ) : null}
    </View>
  )
}

/* ------------------------------------------------------------------ U */
/** U — No add affordance at all: every linked board is a chip, tap toggles armed/not. */
export function VariantU(p: AutoStartVariantProps) {
  const { ids, empty, tone, hint, onToggle } = useAutoStartCard(p)
  const showList = p.enabled && p.linked.length > 1

  return (
    <View style={s.section}>
      <View style={[s.card, tone === 'warn' && s.cardWarn]}>
        <Head
          on={p.enabled}
          tone={tone}
          hint={hint}
          busy={p.masterBusy || p.linked.length === 0}
          onChange={onToggle}
        />

        {showList ? (
          <View style={s.body}>
            <Text style={[s.bodyLabel, empty && s.bodyLabelWarn]}>
              {empty ? 'Tap a board to start the app when it powers on' : 'Detects'}
            </Text>
            <View style={s.chips}>
              {p.linked.map((board) => {
                const armed = ids.has(board.id)
                return (
                  <Pressable
                    key={board.id}
                    style={[s.chip, armed && s.chipOn]}
                    onPress={() => {
                      ease()
                      if (armed) p.onRemove(board.id)
                      else p.onAdd(board.id)
                    }}
                  >
                    {armed ? (
                      <RocketLaunchIcon size={14} weight="fill" color={theme.palette.green.color} />
                    ) : (
                      <PlusIcon size={14} weight="bold" color={theme.palette.slate.textMuted} />
                    )}
                    <Text style={[s.chipText, !armed && s.chipTextOff]}>{board.name}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  )
}

export const AUTO_START_VARIANTS = {
  T: { name: 'Inline expand', Component: VariantT },
  U: { name: 'Tap-to-arm chips', Component: VariantU },
} as const

export type AutoStartVariantKey = keyof typeof AUTO_START_VARIANTS

const s = StyleSheet.create({
  section: { gap: 8, paddingVertical: 4 },

  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surface,
    overflow: 'hidden',
  },
  cardWarn: { borderColor: theme.alpha(theme.palette.amber.color, 0.4) },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  headText: { flex: 1, gap: 3 },
  headTitle: { fontSize: 16, fontWeight: '600' },
  headHint: { fontSize: 12, color: theme.palette.slate.textSecondary },

  body: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  bodyLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: theme.palette.slate.textMuted,
    paddingBottom: 6,
  },
  bodyLabelWarn: { color: theme.palette.amber.color },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 11, color: theme.palette.slate.textMuted },
  addText: { fontSize: 15, color: theme.palette.sky.color, fontWeight: '600' },
  plusOpen: { transform: [{ rotate: '45deg' }] },

  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginLeft: 30,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surface,
  },
  pickText: { gap: 2 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surface,
  },
  chipOn: {
    borderStyle: 'solid',
    borderColor: theme.alpha(theme.palette.green.color, 0.3),
    backgroundColor: theme.alpha(theme.palette.green.color, 0.12),
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  chipTextOff: { color: theme.palette.slate.textSecondary, fontWeight: '500' },

  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.alpha(theme.palette.amber.color, 0.4),
    backgroundColor: theme.alpha(theme.palette.amber.color, 0.12),
  },
  warnText: { flex: 1, fontSize: 12, color: theme.palette.slate.textSecondary },
})
