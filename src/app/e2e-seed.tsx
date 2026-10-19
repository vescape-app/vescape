import { useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { Text } from '@/components/base/Text'
import { errorMessage } from '@/helpers/error'
import { seedOfflineTuneEditor, seedTuneEditor } from '@/screens/e2e/seedTuneEditor'
import { seedE2EData } from 'vescape-core'

export default function E2ESeedScreen() {
  const { flow } = useLocalSearchParams<{ flow: string }>()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (flow) {
      seedE2EData(flow)
    }
    if ((flow === 'tune' || flow === 'tune-offline') && process.env.EXPO_PUBLIC_E2E === '1') {
      void (flow === 'tune-offline' ? seedOfflineTuneEditor() : seedTuneEditor())
        .then(() => router.replace('/tune'))
        .catch((reason: unknown) => setError(errorMessage(reason, 'Tune fixture setup failed')))
    } else router.replace('/')
  }, [flow, router])

  return error ? <Text>{error}</Text> : null
}
