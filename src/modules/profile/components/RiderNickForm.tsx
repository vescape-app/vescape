import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { Input } from '@/components/forms/Input'
import { theme } from '@/constants/theme'
import { useLocationStore } from '@/modules/location/store/locationStore'
import { reverseGeocodeCountry } from '@/modules/map/lib/search'
import { CountryPicker } from '@/modules/profile/components/CountryPicker'
import { countryByCode } from '@/modules/profile/lib/countries'
import { NICK_MAX_LENGTH, parseRiderProfileDraft } from '@/modules/profile/lib/riderProfile'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'

/**
 * Pick or change the Rider Profile nick and optional nationality. The nick saves when the field
 * loses focus and the country as soon as it is picked; the rule or the server's reason (e.g. nick
 * taken) shows only when the nick is refused. A first pick pre-selects the country the phone is in.
 */
export function RiderNickForm({ title }: { title?: string }) {
  const profile = useRiderProfileStore((s) => s.profile)
  const save = useRiderProfileStore((s) => s.save)
  const [nick, setNick] = useState(profile?.nick ?? '')
  const [nationality, setNationality] = useState(profile?.nationality ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNick, setSavedNick] = useState(profile?.nick)
  const countryPicked = useRef(false)
  const hasFix = useLocationStore((s) => s.latestApproximateLocation != null)

  // Only a rider without a profile gets a suggestion; a saved "no country" is a choice.
  const suggestCountry = profile == null && hasFix
  useEffect(() => {
    const fix = useLocationStore.getState().latestApproximateLocation
    if (!suggestCountry || !fix) return
    let live = true
    // intentional-suppression: no suggestion offline or signed out; the rider picks by hand.
    reverseGeocodeCountry(fix.latitude, fix.longitude)
      .then((code) => {
        const country = countryByCode(code)
        if (live && !countryPicked.current && country) setNationality(country.code)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [suggestCountry])

  // Adopt the server value when it arrives or changes elsewhere.
  if (profile?.nick !== savedNick) {
    setSavedNick(profile?.nick)
    setNick(profile?.nick ?? '')
    setNationality(profile?.nationality ?? '')
  }

  /** Saves what is in the fields when it differs from the profile; an empty first nick waits. */
  const commit = async (nextNick: string, nextNationality: string) => {
    if (profile == null && nextNick.trim() === '') return
    const parsed = parseRiderProfileDraft(nextNick, nextNationality)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    const { draft } = parsed
    if (profile && draft.nick === profile.nick && draft.nationality === profile.nationality) return
    setSaving(true)
    setError(null)
    try {
      await save(draft)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.container}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.labelRow}>
        <Text style={styles.label}>Nick</Text>
        {saving ? <Text style={styles.saving}>Saving…</Text> : null}
      </View>
      <Input
        value={nick}
        onChangeText={(value) => {
          setNick(value)
          setError(null)
        }}
        onEndEditing={() => void commit(nick, nationality)}
        placeholder="e.g. kuba_rides"
        maxLength={NICK_MAX_LENGTH}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        accessibilityLabel="Nick"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.label}>Country (optional)</Text>
      <CountryPicker
        value={nationality}
        onChange={(code) => {
          countryPicked.current = true
          setNationality(code)
          setError(null)
          void commit(nick, code)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    alignSelf: 'stretch',
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  label: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  saving: {
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
  error: {
    color: theme.status.error.text,
    fontSize: 12,
  },
})
