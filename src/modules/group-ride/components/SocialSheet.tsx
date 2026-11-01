import { useState } from 'react'
import { FadeCardModal } from '@/components/modals/FadeCardModal'
import { Input } from '@/components/forms/Input'
import { useRouter } from 'expo-router'
import { useUser } from '@clerk/expo'
import { routes } from '@/navigation/routes'
import { PublicRidePrototype } from './public-ride-prototype/PublicRidePrototype'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  CheckIcon,
  SignInIcon,
  BroadcastIcon,
  CrosshairIcon,
  UserCircleIcon,
  PlusIcon,
  SignOutIcon,
  UsersIcon,
  WarningIcon,
  XIcon,
} from 'phosphor-react-native'
import { IconButton } from '@/components/base/IconButton'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { Switch } from '@/components/controls/Switch'
import { CanvasWidget } from '@/components/widgets/CanvasWidget'
import { InputWidget } from '@/components/widgets/InputWidget'
import { useGroupRideStore } from '@/modules/group-ride/store/groupRideStore'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useRiderStore } from '@/modules/group-ride/store/riderStore'
import { useSelectedBoardRailColor } from '@/modules/group-ride/lib/selectedBoardRailColor'
import { theme } from '@/constants/theme'
import { NearbyRideBody, RosterGrid } from '@/modules/group-ride/components/GroupRideRoster'

export function SocialSheet({
  page,
  onPageChange,
  onShowOnMap,
}: {
  page: string
  onPageChange: (page: string) => void
  onShowOnMap?: () => void
}) {
  if (__DEV__)
    return (
      <PublicRidePrototype
        identity={<RiderNameWidget compact />}
        page={page}
        onPageChange={onPageChange}
        onShowOnMap={onShowOnMap}
      />
    )
  return (
    <View testID="social-sheet" style={styles.list}>
      <RiderNameWidget />
      <GroupRideWidget />
    </View>
  )
}

function RiderNameWidget({ compact = false }: { compact?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState('')
  const router = useRouter()
  const { isSignedIn } = useUser()
  const riderName = useRiderStore((s) => s.riderName)
  const setName = useRiderStore((s) => s.setName)
  const error = useRiderStore((s) => s.error)
  const riderColor = useSelectedBoardRailColor()
  const neutral = useResolvedNeutralColors()
  const saveName = () => {
    if (!draft.trim() || saving) return
    setSaving(true)
    // intentional-suppression: Rider store error is shown in this dialog.
    void setName(draft.trim())
      .then(() => setEditing(false))
      .catch(() => undefined)
      .finally(() => setSaving(false))
  }

  if (compact)
    return (
      <>
        <Button
          label={riderName || 'Add name'}
          icon={UserCircleIcon}
          size="sm"
          variant="secondary"
          onPress={() => {
            setDraft(riderName ?? '')
            setEditing(true)
          }}
        />
        <FadeCardModal
          visible={editing}
          title="Rider profile"
          titleIcon={UserCircleIcon}
          titleIconColor={theme.neutral.textSecondary}
          scrollable={false}
          dismissDisabled={saving}
          onDismiss={() => setEditing(false)}
        >
          <View style={styles.list}>
            <Text style={{ color: neutral.textSecondary, fontSize: 12 }}>Display name</Text>
            <View style={styles.nameEditor}>
              <Input
                style={styles.nameInput}
                value={draft}
                onChangeText={setDraft}
                maxLength={32}
                placeholder="Enter your name"
                accessibilityLabel="Rider display name"
                returnKeyType="done"
                onSubmitEditing={saveName}
                editable={!saving}
              />
              <IconButton
                icon={CheckIcon}
                onPress={saveName}
                loading={saving}
                disabled={!draft.trim()}
                accent={theme.palette.groupRide.color}
                accessibilityLabel="Save display name"
              />
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <View style={styles.orSeparator}>
              <View style={[styles.separatorLine, { backgroundColor: neutral.border }]} />
              <Text style={{ color: neutral.textSecondary, fontSize: 12 }}>or</Text>
              <View style={[styles.separatorLine, { backgroundColor: neutral.border }]} />
            </View>
            <Button
              label={isSignedIn ? 'Account' : 'Sign in'}
              icon={isSignedIn ? UserCircleIcon : SignInIcon}
              variant="secondary"
              disabled={saving}
              onPress={() => {
                setEditing(false)
                router.push(isSignedIn ? routes.account : routes.signIn)
              }}
            />
          </View>
        </FadeCardModal>
      </>
    )

  return (
    <View style={styles.riderIdentity}>
      <InputWidget
        label="Your name"
        value={riderName}
        placeholder="Add a display name"
        maxLength={32}
        onCommit={(value) => {
          // intentional-suppression: Rider store error is rendered by Social Sheet
          void setName(value).catch(() => undefined) // The store exposes this failure below.
        }}
        accessibilityLabel="Rider display name"
        leading={
          <UserCircleIcon
            size={24}
            color={riderColor ?? theme.neutral.textSecondary}
            weight="duotone"
          />
        }
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
}

function GroupRideWidget() {
  useRenderRateWarning('GroupRideWidget')
  const activeRideId = useGroupRideStore((s) => s.activeRideId)
  const rides = useGroupRideStore((s) => s.rides)
  const nearby = useGroupRideStore((s) => s.nearby)
  const rosterRows = useGroupRideStore((s) => s.rosterRows)
  const connection = useGroupRideStore((s) => s.connection)
  const hasLocation = useGroupRideStore((s) => s.ownLocation !== null)
  const createRide = useGroupRideStore((s) => s.createRide)
  const leaveRide = useGroupRideStore((s) => s.leaveRide)
  const joinRide = useGroupRideStore((s) => s.joinRide)
  const publicRiding = useGroupRideStore((s) => s.publicRiding)
  const setPublicRiding = useGroupRideStore((s) => s.setPublicRiding)

  const [nearbyDismissed, setNearbyDismissed] = useState(false)

  const activeRide = rides.find((r) => r.id === activeRideId)
  const active = activeRideId != null
  const connected = connection === 'connected'
  // Native gates the relay socket when the installed version is Online/App Blocked and reports it
  // as `blocked`; Group Ride is unusable until the app updates, so replace the live UI entirely.
  const blocked = connection === 'blocked'
  const showNearby = !active && nearby.length > 0 && !nearbyDismissed
  const accent = theme.palette.groupRide.color
  const rideName = activeRide?.name?.trim() || 'Your group ride'

  if (blocked) {
    return (
      <CanvasWidget
        icon={BroadcastIcon}
        title="Group Ride"
        accent={accent}
        surface="secondary"
        height={240}
        footer={
          <Button
            label="Create"
            variant="groupRide"
            icon={PlusIcon}
            onPress={() => {}}
            disabled
            style={styles.fill}
            accessibilityLabel="Create group ride"
          />
        }
      >
        <Placeholder icon={WarningIcon} description="Not available in this version." />
      </CanvasWidget>
    )
  }

  const footer = active ? (
    <Button
      label="Leave"
      variant="destructive"
      icon={SignOutIcon}
      onPress={leaveRide}
      style={styles.fill}
      accessibilityLabel="Leave group ride"
    />
  ) : showNearby ? (
    <Button
      label="Join"
      variant="groupRide"
      onPress={() => joinRide(nearby[0].ride.id)}
      disabled={!connected}
      style={styles.fill}
      accessibilityLabel="Join nearest group ride"
    />
  ) : (
    <Button
      label="Create"
      variant="groupRide"
      icon={PlusIcon}
      onPress={() => createRide('')}
      disabled={!hasLocation || !connected}
      style={styles.fill}
      accessibilityLabel="Create group ride"
    />
  )

  const status = active ? (
    <LiveBadge connected={connection === 'connected'} />
  ) : showNearby ? (
    <Pressable
      onPress={() => setNearbyDismissed(true)}
      hitSlop={10}
      accessibilityLabel="Dismiss nearby rides"
    >
      <XIcon size={18} color={theme.neutral.textSecondary} weight="bold" />
    </Pressable>
  ) : null

  const action = (
    <View style={styles.headerActions}>
      {status}
      <Text style={styles.fieldLabel}>Auto</Text>
      <Switch
        value={publicRiding}
        onValueChange={setPublicRiding}
        accent={accent}
        accessibilityLabel="Ride publicly"
      />
    </View>
  )

  return (
    <CanvasWidget
      icon={BroadcastIcon}
      title={active ? rideName : 'Group Ride'}
      accent={accent}
      surface="secondary"
      active={active}
      height={active && rosterRows.length > 0 ? undefined : 240}
      footer={footer}
      action={action}
    >
      {active ? (
        rosterRows.length > 0 ? (
          <RosterGrid rows={rosterRows} accent={accent} connected={connection === 'connected'} />
        ) : (
          <Placeholder icon={UsersIcon} description="Waiting for other riders to join." />
        )
      ) : publicRiding ? (
        <Placeholder
          icon={BroadcastIcon}
          description="Auto is on. When your board connects, you join the nearest group ride or start one."
        />
      ) : showNearby ? (
        <NearbyRideBody nearby={nearby} />
      ) : !connected ? (
        <Placeholder icon={BroadcastIcon} description="Connecting to server…" />
      ) : !hasLocation ? (
        <Placeholder icon={CrosshairIcon} description="Finding your location…" />
      ) : (
        <Placeholder icon={BroadcastIcon} description="No group rides near you right now." />
      )}
    </CanvasWidget>
  )
}

/** Connection-state pill in the header: green "LIVE" when the relay socket is up, amber
 *  "OFFLINE" when presence can't reach the server (e.g. no internet). */
function LiveBadge({ connected }: { connected: boolean }) {
  const tone = connected ? theme.palette.groupRide : theme.palette.amber
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
      <View style={[styles.badgeDot, { backgroundColor: tone.color }]} />
      <Text style={[styles.badgeLabel, { color: tone.light }]}>
        {connected ? 'LIVE' : 'OFFLINE'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  nameEditor: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameInput: { flex: 1, minWidth: 0 },
  orSeparator: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  separatorLine: { flex: 1, height: StyleSheet.hairlineWidth },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  fieldLabel: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  fill: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  list: {
    gap: 12,
  },
  riderIdentity: {
    gap: 6,
  },
  errorText: {
    color: theme.status.error.text,
    fontSize: 12,
  },
})
