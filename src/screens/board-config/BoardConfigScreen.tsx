import { useLayoutEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { router, useLocalSearchParams, useNavigation } from 'expo-router'
import { BracketsCurlyIcon, CaretDownIcon, CaretUpIcon, WrenchIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { IconHero } from '@/components/settings/IconHero'
import { Text } from '@/components/base/Text'
import { PageScrollView } from '@/components/base/PageScrollView'
import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { theme } from '@/constants/theme'
import { fmtTimeAgo } from '@/helpers/format'
import { BoardConfigSection } from '@/modules/board/components/BoardConfigSection'
import {
  useBoardConfigFields,
  useBoardConfigValuesStore,
} from '@/modules/board/store/boardConfigValuesStore'
import {
  useMotorConfigFields,
  useMotorConfigValuesStore,
} from '@/modules/board/store/motorConfigValuesStore'
import { splitConfigGroups } from '@/modules/board/lib/splitConfigGroups'
import type { BoardConfigGroup } from '@/modules/board/constants/boardConfigTabs'
import { boardConfigTabs } from '@/screens/board-config/boardConfigGroups'
import { routes } from '@/navigation/routes'

export default function BoardConfigScreen() {
  const { boardId } = useLocalSearchParams<{ boardId: string }>()
  const navigation = useNavigation()
  const [activeTab, setActiveTab] = useState('quick')
  const [expandedTabs, setExpandedTabs] = useState<Set<string>>(() => new Set())
  const refloat = useBoardConfigFields(boardId)
  const motor = useMotorConfigFields(boardId)
  const refloatError = useBoardConfigValuesStore((state) => state.error)
  const motorError = useMotorConfigValuesStore((state) => state.error)
  const now = Date.now()
  const refloatReadTime = refloat ? fmtTimeAgo(refloat.capturedAtMs, now) : null
  const motorReadTime = motor ? fmtTimeAgo(motor.capturedAtMs, now) : null

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton
          icon={BracketsCurlyIcon}
          onPress={() => router.push({ pathname: routes.boardConfigRaw, params: { boardId } })}
          accessibilityLabel="Raw board config"
          testID="board-config-raw-button"
        />
      ),
    })
  }, [navigation, boardId])

  const tabs = useMemo(() => boardConfigTabs(refloat?.values, motor?.values), [refloat, motor])
  const groups = tabs.find((tab) => tab.id === activeTab)!.groups
  const { primary, advanced, advancedCount } = splitConfigGroups(groups)
  const expanded = expandedTabs.has(activeTab)
  const renderGroup = (group: BoardConfigGroup) => (
    <BoardConfigSection
      key={`${group.source}-${group.title}`}
      showFreshness={false}
      showDescriptions={activeTab === 'quick'}
      boardId={boardId}
      title={group.title}
      rows={group.rows}
      values={group.source === 'refloat' ? refloat : motor}
      error={group.source === 'refloat' ? refloatError : motorError}
      empty={`No saved ${group.source === 'motor' ? 'motor ' : ''}config. Connect this board to read it.`}
    />
  )

  return (
    <View style={styles.container}>
      <PageScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={WrenchIcon}
          description="Your board's Refloat settings and motor limits, grouped by topic."
        >
          <View style={styles.readInfo}>
            {refloatReadTime && refloatReadTime === motorReadTime ? (
              <Text style={styles.readTime}>{`Config read ${refloatReadTime}`}</Text>
            ) : (
              <>
                <Text style={styles.readTime}>
                  {refloatReadTime
                    ? `Refloat read ${refloatReadTime}`
                    : 'No Refloat config read yet'}
                </Text>
                <Text style={styles.readTime}>
                  {motorReadTime
                    ? `Motor config read ${motorReadTime}`
                    : 'No motor config read yet'}
                </Text>
              </>
            )}
          </View>
        </IconHero>
        <View style={styles.tabs}>
          <PillSelector activeId={activeTab} showFullLabel variant="lightTabs">
            {tabs.map((tab) => (
              <PillSelectorItem
                key={tab.id}
                id={tab.id}
                label={tab.label}
                color={theme.palette.sky}
                onPress={() => setActiveTab(tab.id)}
                testID={`board-config-tab-${tab.id}`}
              />
            ))}
          </PillSelector>
        </View>
        <View key={activeTab} style={styles.groups}>
          {primary.map(renderGroup)}
          {advancedCount > 0 ? (
            <>
              <Button
                label={expanded ? 'Show fewer options' : `Show ${advancedCount} more options`}
                variant="secondary"
                icon={expanded ? CaretUpIcon : CaretDownIcon}
                testID="board-config-more-options"
                onPress={() =>
                  setExpandedTabs((current) => {
                    const next = new Set(current)
                    if (next.has(activeTab)) next.delete(activeTab)
                    else next.add(activeTab)
                    return next
                  })
                }
              />
              {expanded ? <View style={styles.groups}>{advanced.map(renderGroup)}</View> : null}
            </>
          ) : null}
        </View>
      </PageScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 16, gap: 24 },
  tabs: { backgroundColor: theme.neutral.bg, paddingVertical: 8 },
  groups: { gap: 28 },
  readInfo: { gap: 4, alignItems: 'center' },
  readTime: { color: theme.neutral.textSecondary, fontSize: 12, textAlign: 'center' },
})
