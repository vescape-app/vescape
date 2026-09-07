import { Alert, Linking } from 'react-native'

import { reportUnexpectedError } from '@/config/sentry'

export function openExternalUrl(url: string, source: string): void {
  void Linking.openURL(url).catch((error: unknown) => {
    reportUnexpectedError(error, source)
    Alert.alert('Could not open link', 'Try again or open the address in your browser.')
  })
}
