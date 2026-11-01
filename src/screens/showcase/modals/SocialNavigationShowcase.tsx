import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { OpenButton } from '@/components/dev/ShowcaseControls'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { useTriggerRef } from '@/components/overlays/measureTrigger'
import { SocialDrawerHeader } from '@/modules/group-ride/components/public-ride-prototype/SocialDrawerHeader'
import { SocialPageStack } from '@/modules/group-ride/components/public-ride-prototype/SocialPageStack'

export function SocialNavigationShowcase() {
  const triggerRef = useTriggerRef()
  const [visible, setVisible] = useState(false)
  const [detail, setDetail] = useState(false)
  const close = () => setVisible(false)
  const back = () => setDetail(false)
  return (
    <ShowcaseCard
      name="Social — page navigation"
      controls={
        <View ref={triggerRef} collapsable={false}>
          <OpenButton
            label="Open Social navigation"
            onPress={() => {
              setDetail(false)
              setVisible(true)
            }}
          />
        </View>
      }
    >
      <Text>Forward, back, Android Back and system reduced motion.</Text>
      <EdgeDrawer
        visible={visible}
        triggerRef={triggerRef}
        edge="top"
        onClose={close}
        onBack={detail ? back : undefined}
        contentPageKey={detail ? 'kuba' : 'nearby'}
        header={
          <SocialDrawerHeader
            riderName={detail ? 'Kuba' : undefined}
            onBack={back}
            onClose={close}
          />
        }
      >
        <SocialPageStack page={detail ? 'kuba' : 'nearby'} detail={detail}>
          <View style={styles.body}>
            <Text>{detail ? 'Kuba’s rider profile' : 'Nearby riders'}</Text>
            <Button
              label={detail ? 'Back to Social' : 'Open Kuba'}
              variant="secondary"
              onPress={detail ? back : () => setDetail(true)}
            />
          </View>
        </SocialPageStack>
      </EdgeDrawer>
    </ShowcaseCard>
  )
}
const styles = StyleSheet.create({ body: { gap: 16, paddingVertical: 32 } })
