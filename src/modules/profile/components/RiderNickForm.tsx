import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { Input } from '@/components/forms/Input'
import { theme } from '@/constants/theme'
import { NICK_MAX_LENGTH, parseRiderProfileDraft } from '@/modules/profile/lib/riderProfile'
import { useRiderProfileStore } from '@/modules/profile/store/riderProfileStore'

/**
 * Pick or change the Rider Profile nick and optional nationality. Shows the local rule or the
 * server's reason (e.g. nick taken) next to the fields.
 */
export function RiderNickForm({ title }: { title?: string }) {
  const profile = useRiderProfileStore((s) => s.profile)
  const save = useRiderProfileStore((s) => s.save)
  const [nick, setNick] = useState(profile?.nick ?? '')
  const [nationality, setNationality] = useState(profile?.nationality ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNick, setSavedNick] = useState(profile?.nick)

  // Adopt the server value when it arrives or changes elsewhere.
  if (profile?.nick !== savedNick) {
    setSavedNick(profile?.nick)
    setNick(profile?.nick ?? '')
    setNationality(profile?.nationality ?? '')
  }

  const unchanged =
    profile != null &&
    nick.trim() === profile.nick &&
    (nationality.trim().toUpperCase() || null) === profile.nationality

  const submit = async () => {
    const parsed = parseRiderProfileDraft(nick, nationality)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await save(parsed.draft)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.container}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.fields}>
        <Input
          style={styles.nick}
          value={nick}
          onChangeText={(value) => {
            setNick(value)
            setError(null)
          }}
          placeholder="Nick"
          maxLength={NICK_MAX_LENGTH}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Nick"
        />
        <Input
          style={styles.nationality}
          value={nationality}
          onChangeText={(value) => {
            setNationality(value.toUpperCase())
            setError(null)
          }}
          placeholder="PL"
          maxLength={2}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Nationality, two-letter country code"
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label={profile ? 'Save nick' : 'Pick nick'}
        loading={saving}
        disabled={unchanged || nick.trim().length === 0}
        onPress={() => void submit()}
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
  fields: {
    flexDirection: 'row',
    gap: 8,
  },
  nick: {
    flex: 1,
  },
  nationality: {
    width: 64,
    textAlign: 'center',
  },
  error: {
    color: theme.status.error.text,
    fontSize: 12,
  },
})
