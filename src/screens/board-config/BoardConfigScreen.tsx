import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams, useNavigation } from 'expo-router'
import {
  CaretDownIcon,
  CaretUpIcon,
  DotsThreeIcon,
  GearSixIcon,
  WrenchIcon,
} from 'phosphor-react-native'

import { Banner } from '@/components/base/Banner'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { PageScrollView } from '@/components/base/PageScrollView'
import { Text } from '@/components/base/Text'
import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { SearchInput } from '@/components/forms/SearchInput'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import { fmtTimeAgo } from '@/helpers/format'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import { BoardConfigOptionsSheet } from '@/modules/board/components/BoardConfigOptionsSheet'
import { BoardConfigReviewModal } from '@/modules/board/components/BoardConfigReviewModal'
import { BoardConfigSection } from '@/modules/board/components/BoardConfigSection'
import type { BoardConfigGroup } from '@/modules/board/constants/boardConfigTabs'
import {
  buildBoardConfigReviewEntries,
  hasPendingBoardConfigChange,
} from '@/modules/board/lib/boardConfigChangeset'
import {
  deriveBoardConfigTabsFromSchema,
  searchSchemaBoardConfig,
  type BoardConfigSchemaTab,
} from '@/modules/board/lib/boardConfigSchemaGroups'
import { searchBoardConfig } from '@/modules/board/lib/searchBoardConfig'
import { splitConfigGroups } from '@/modules/board/lib/splitConfigGroups'
import {
  useBoardConfigFields,
  useBoardConfigValuesStore,
} from '@/modules/board/store/boardConfigValuesStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import {
  useMotorConfigFields,
  useMotorConfigValuesStore,
} from '@/modules/board/store/motorConfigValuesStore'
import { routes } from '@/navigation/routes'
import { boardConfigTabs } from '@/screens/board-config/boardConfigGroups'
import {
  BoardConfigPendingBar,
  BoardConfigSchemaSectionCard,
} from '@/screens/board-config/BoardConfigSchemaParts'
import {
  applyReviewedBoardConfigChangeset,
  resolveReviewModalState,
  useBoardConfigXmlTransfer,
} from '@/screens/board-config/useBoardConfigXmlTransfer'

type FallbackTab = ReturnType<typeof boardConfigTabs>[number]

function omitPendingKey(
  record: Record<string, number | boolean>,
  keyToRemove: string,
): Record<string, number | boolean> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== keyToRemove))
}

function collectFieldLabels(
  schemaTabs: BoardConfigSchemaTab[] | null,
  fallbackTabs: FallbackTab[] | null,
): Record<string, string> {
  const labels: Record<string, string> = {}
  if (schemaTabs) {
    for (const tab of schemaTabs) {
      if (tab.kind === 'schema') {
        for (const section of tab.sections) {
          for (const field of section.fields) {
            if (!labels[field.id]) labels[field.id] = field.label
          }
        }
      } else {
        for (const group of tab.groups) {
          for (const row of group.rows) {
            if (!labels[row.id]) labels[row.id] = row.label
          }
        }
      }
    }
    return labels
  }
  for (const tab of fallbackTabs ?? []) {
    for (const group of tab.groups) {
      for (const row of group.rows) {
        if (!labels[row.id]) labels[row.id] = row.label
      }
    }
  }
  return labels
}

function BoardConfigReadInfo({
  refloatReadTime,
  motorReadTime,
}: {
  refloatReadTime: string | null
  motorReadTime: string | null
}) {
  return (
    <View style={styles.readInfo}>
      {refloatReadTime && refloatReadTime === motorReadTime ? (
        <Text style={styles.readTime}>{`Config read ${refloatReadTime}`}</Text>
      ) : (
        <>
          <Text style={styles.readTime}>
            {refloatReadTime ? `Refloat read ${refloatReadTime}` : 'No Refloat config read yet'}
          </Text>
          <Text style={styles.readTime}>
            {motorReadTime ? `Motor config read ${motorReadTime}` : 'No motor config read yet'}
          </Text>
        </>
      )}
    </View>
  )
}

function BoardConfigStatusBanners({
  hasSchema,
  canEdit,
  xmlError,
  xmlNotice,
}: {
  hasSchema: boolean
  canEdit: boolean
  xmlError: string | null
  xmlNotice: string | null
}) {
  return (
    <>
      {hasSchema && !canEdit ? (
        <Banner
          variant="info"
          message="Showing last known config. Connect this board to edit settings."
        />
      ) : null}
      {xmlError ? <Banner variant="error" message={xmlError} /> : null}
      {xmlNotice ? <Banner variant="info" message={xmlNotice} /> : null}
    </>
  )
}

export default function BoardConfigScreen() {
  const { boardId } = useLocalSearchParams<{ boardId: string }>()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { temperatureUnit } = useUserPreferences()

  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [expandedTabs, setExpandedTabs] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [pendingChanges, setPendingChanges] = useState<Record<string, number | boolean>>({})
  const [reviewOpen, setReviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const optionsAnchorRef = useRef<View>(null)

  const board = useBoardStore((state) => state.boards.find((item) => item.id === boardId))
  const refloat = useBoardConfigFields(boardId)
  const motor = useMotorConfigFields(boardId)
  const refloatError = useBoardConfigValuesStore((state) => state.error)
  const motorError = useMotorConfigValuesStore((state) => state.error)
  const now = Date.now()
  const refloatReadTime = refloat ? fmtTimeAgo(refloat.capturedAtMs, now) : null
  const motorReadTime = motor ? fmtTimeAgo(motor.capturedAtMs, now) : null
  const schema = refloat?.schema ?? null
  const canEdit = refloat?.freshness === 'fresh'

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View ref={optionsAnchorRef} collapsable={false}>
          <IconButton
            icon={DotsThreeIcon}
            onPress={() => setOptionsOpen(true)}
            accessibilityLabel="Board config options"
            testID="board-config-options-button"
          />
        </View>
      ),
    })
  }, [navigation])

  const schemaTabs = useMemo(
    () =>
      schema && refloat
        ? deriveBoardConfigTabsFromSchema(schema, refloat.values, motor?.values)
        : null,
    [schema, refloat, motor],
  )

  const fallbackTabs = useMemo(
    () => (schemaTabs ? null : boardConfigTabs(refloat?.values, motor?.values)),
    [schemaTabs, refloat, motor],
  )

  const pillTabs = schemaTabs ?? fallbackTabs ?? []
  const resolvedActiveTabId =
    activeTab && pillTabs.some((tab) => tab.id === activeTab)
      ? activeTab
      : (pillTabs[0]?.id ?? 'quick')

  const fieldLabels = useMemo(
    () => collectFieldLabels(schemaTabs, fallbackTabs),
    [schemaTabs, fallbackTabs],
  )

  const loadedSources = useMemo(
    () =>
      [refloat && 'refloat', motor && 'motor'].filter((source): source is 'refloat' | 'motor' =>
        Boolean(source),
      ),
    [refloat, motor],
  )

  const searching = query.trim().length > 0

  const schemaSearchResults = useMemo(
    () =>
      searching && schemaTabs ? searchSchemaBoardConfig(schemaTabs, query, loadedSources) : [],
    [searching, schemaTabs, query, loadedSources],
  )

  const fallbackSearchResults = useMemo(
    () => (searching && fallbackTabs ? searchBoardConfig(fallbackTabs, query, loadedSources) : []),
    [searching, fallbackTabs, query, loadedSources],
  )

  const handleFieldChange = useCallback(
    (fieldId: string, nextValue: number | boolean) => {
      if (!canEdit) return
      const currentValue = refloat?.values[fieldId]
      setApplyError(null)
      setPendingChanges((prev) => {
        if (!hasPendingBoardConfigChange(currentValue, nextValue)) {
          return fieldId in prev ? omitPendingKey(prev, fieldId) : prev
        }
        return { ...prev, [fieldId]: nextValue }
      })
    },
    [canEdit, refloat],
  )

  const handleResetField = useCallback((fieldId: string) => {
    setApplyError(null)
    setPendingChanges((prev) => (fieldId in prev ? omitPendingKey(prev, fieldId) : prev))
  }, [])

  const handleDiscardAll = useCallback(() => {
    setPendingChanges({})
    setApplyError(null)
  }, [])

  const pendingCount = Object.keys(pendingChanges).length

  const reviewEntries = useMemo(
    () =>
      refloat
        ? buildBoardConfigReviewEntries({
            changes: pendingChanges,
            currentValues: refloat.values,
            schema,
            refloatBaseVersion: refloat.refloatBaseVersion,
            temperatureUnit,
          })
        : [],
    [pendingChanges, refloat, schema, temperatureUnit],
  )

  const closeOptions = useCallback(() => setOptionsOpen(false), [])
  const resetApplyError = useCallback(() => setApplyError(null), [])

  const xmlTransfer = useBoardConfigXmlTransfer({
    boardId,
    boardName: board?.name,
    canEdit,
    currentValues: refloat?.values,
    schema,
    refloatBaseVersion: refloat?.refloatBaseVersion,
    temperatureUnit,
    onCloseOptions: closeOptions,
    onResetApplyError: resetApplyError,
  })

  const handleConfirmApply = useCallback(async () => {
    setSaving(true)
    setApplyError(null)
    const outcome = await applyReviewedBoardConfigChangeset({
      boardId,
      canEdit,
      importPlan: xmlTransfer.importPlan,
      pendingChanges,
      currentSchemaHash: refloat?.schemaHash,
    })
    setSaving(false)
    if (outcome.kind === 'error') {
      setApplyError(outcome.message)
      return
    }
    if (outcome.kind !== 'applied') return
    useBoardConfigValuesStore.getState().replace(outcome.updated)
    if (outcome.isImport) {
      xmlTransfer.clearImportPlan()
      xmlTransfer.setXmlNotice('Config imported and written to board.')
    } else {
      setPendingChanges({})
      setReviewOpen(false)
    }
  }, [boardId, canEdit, pendingChanges, refloat?.schemaHash, xmlTransfer])

  const renderReadOnlyGroup = (group: BoardConfigGroup) => (
    <BoardConfigSection
      key={`${group.source}-${group.title}`}
      showFreshness={false}
      showDescriptions={searching || resolvedActiveTabId === 'quick'}
      boardId={boardId}
      title={group.title}
      rows={group.rows}
      values={group.source === 'refloat' ? refloat : motor}
      error={group.source === 'refloat' ? refloatError : motorError}
      empty={`No saved ${group.source === 'motor' ? 'motor ' : ''}config. Connect this board to read it.`}
    />
  )

  const renderMotorGroupsWithCollapse = (groups: BoardConfigGroup[], tabKey: string) => {
    const { primary, advanced, advancedCount } = splitConfigGroups(groups)
    const expanded = expandedTabs.has(tabKey)
    return (
      <View key={tabKey} style={styles.groups}>
        {primary.map(renderReadOnlyGroup)}
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
                  if (next.has(tabKey)) next.delete(tabKey)
                  else next.add(tabKey)
                  return next
                })
              }
            />
            {expanded ? (
              <View style={styles.groups}>{advanced.map(renderReadOnlyGroup)}</View>
            ) : null}
          </>
        ) : null}
      </View>
    )
  }

  const reviewModal = resolveReviewModalState({
    reviewOpen,
    hasImportPlan: xmlTransfer.importPlan !== null,
    canEdit,
    applyError,
    reviewEntries,
    importReviewEntries: xmlTransfer.importReviewEntries,
  })
  const handleCancelReview = useCallback(() => {
    if (saving) return
    if (xmlTransfer.importPlan !== null) xmlTransfer.clearImportPlan()
    else setReviewOpen(false)
  }, [saving, xmlTransfer])

  const handleOpenRawConfig = useCallback(() => {
    setOptionsOpen(false)
    router.push({ pathname: routes.boardConfigRaw, params: { boardId } })
  }, [boardId])

  const activeSchemaTab = schemaTabs?.find((tab) => tab.id === resolvedActiveTabId) ?? null
  const activeFallbackTab = fallbackTabs?.find((tab) => tab.id === resolvedActiveTabId) ?? null
  const riskyPendingCount = reviewEntries.filter((entry) => entry.risk === 'risky').length
  const emptySearchMessage =
    refloat || motor
      ? `No config options match “${query.trim()}”.`
      : 'No saved config to search. Connect this board to read it.'

  const renderActiveTabBody = () => {
    if (activeSchemaTab) {
      if (activeSchemaTab.kind === 'motor') {
        return renderMotorGroupsWithCollapse(activeSchemaTab.groups, activeSchemaTab.id)
      }
      return (
        <View key={activeSchemaTab.id} style={styles.schemaSections}>
          {activeSchemaTab.readOnly ? (
            <Banner
              variant="info"
              message="Internal metadata fields are read-only and cannot be edited."
            />
          ) : null}
          {activeSchemaTab.sections.map((section) => (
            <BoardConfigSchemaSectionCard
              key={section.id}
              section={section}
              pendingChanges={pendingChanges}
              refloatBaseVersion={refloat?.refloatBaseVersion}
              disabled={!canEdit}
              showDescription={false}
              onFieldChange={handleFieldChange}
              onResetField={handleResetField}
            />
          ))}
        </View>
      )
    }
    if (activeFallbackTab) {
      return renderMotorGroupsWithCollapse(activeFallbackTab.groups, activeFallbackTab.id)
    }
    return null
  }

  const renderSearchBody = () => {
    if (schemaTabs) {
      if (schemaSearchResults.length === 0) {
        return <Text style={styles.noResults}>{emptySearchMessage}</Text>
      }
      return schemaSearchResults.map((result) =>
        result.kind === 'schema' && result.fields ? (
          <BoardConfigSchemaSectionCard
            key={result.key}
            section={{ id: result.key, title: result.title, fields: result.fields }}
            pendingChanges={pendingChanges}
            refloatBaseVersion={refloat?.refloatBaseVersion}
            disabled={!canEdit}
            showDescription
            onFieldChange={handleFieldChange}
            onResetField={handleResetField}
          />
        ) : result.rows ? (
          renderReadOnlyGroup({
            title: result.title,
            source: 'motor',
            rows: result.rows,
          })
        ) : null,
      )
    }
    if (fallbackSearchResults.length === 0) {
      return <Text style={styles.noResults}>{emptySearchMessage}</Text>
    }
    return fallbackSearchResults.map(renderReadOnlyGroup)
  }

  return (
    <View style={styles.container}>
      <PageScrollView
        contentContainerStyle={[styles.content, pendingCount > 0 && styles.contentWithBar]}
        keyboardShouldPersistTaps="handled"
      >
        <IconHero
          icon={WrenchIcon}
          description="Your board's Refloat config and motor limits, grouped by topic."
        >
          <BoardConfigReadInfo refloatReadTime={refloatReadTime} motorReadTime={motorReadTime} />
        </IconHero>

        <BoardConfigStatusBanners
          hasSchema={schema !== null}
          canEdit={canEdit}
          xmlError={xmlTransfer.xmlError}
          xmlNotice={xmlTransfer.xmlNotice}
        />

        <SearchInput
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Search board config"
          testID="board-config-search"
          style={styles.search}
        />

        {searching ? (
          <View style={styles.groups}>{renderSearchBody()}</View>
        ) : (
          <>
            <View style={styles.tabs}>
              <PillSelector
                activeId={resolvedActiveTabId}
                showFullLabel
                centerActive
                variant="lightTabs"
              >
                {pillTabs.map((tab) => (
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
            {renderActiveTabBody()}
          </>
        )}
      </PageScrollView>

      {pendingCount > 0 ? (
        <BoardConfigPendingBar
          pendingCount={pendingCount}
          riskyPendingCount={riskyPendingCount}
          saving={saving}
          reviewDisabled={!canEdit}
          bottomInset={insets.bottom}
          onDiscard={handleDiscardAll}
          onReview={() => {
            setApplyError(null)
            setReviewOpen(true)
          }}
        />
      ) : null}

      <BoardConfigReviewModal
        visible={reviewModal.visible}
        source={reviewModal.source}
        boardName={board?.name}
        entries={reviewModal.entries}
        skippedFields={xmlTransfer.importPlan?.skippedFields}
        saving={saving}
        confirmDisabled={reviewModal.confirmDisabled}
        error={reviewModal.error}
        onConfirm={handleConfirmApply}
        onCancel={handleCancelReview}
      />

      <EdgeDrawer
        visible={optionsOpen}
        triggerRef={optionsAnchorRef}
        title="Board config"
        icon={GearSixIcon}
        onClose={closeOptions}
      >
        <BoardConfigOptionsSheet
          boardId={boardId}
          fieldLabels={fieldLabels}
          canTransferXml={xmlTransfer.canTransferXml}
          onOpenRawConfig={handleOpenRawConfig}
          onExportXml={() => void xmlTransfer.handleExportXml()}
          onImportXml={() => void xmlTransfer.handleImportXml()}
        />
      </EdgeDrawer>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 16, gap: 24 },
  contentWithBar: { paddingBottom: 112 },
  tabs: { backgroundColor: theme.neutral.bg, paddingVertical: 8 },
  groups: { gap: 28 },
  schemaSections: { gap: 18 },
  search: {
    justifyContent: 'center',
    alignSelf: 'center',
    width: '70%',
    marginTop: -24,
  },
  noResults: { color: theme.neutral.textSecondary, fontSize: 14, textAlign: 'center' },
  readInfo: { gap: 4, alignItems: 'center' },
  readTime: { color: theme.neutral.textSecondary, fontSize: 12, textAlign: 'center' },
})
