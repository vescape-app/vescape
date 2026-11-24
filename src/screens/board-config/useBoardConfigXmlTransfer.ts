import { useCallback, useMemo, useState } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import {
  exportBoardConfigXml,
  planBoardConfigXmlImport,
  type BoardConfigSchema,
  type BoardConfigXmlImportPlan,
} from 'vescape-core'

import { errorMessage } from '@/helpers/error'
import type { TemperatureUnit } from '@/helpers/units'
import { buildBoardConfigReviewEntries } from '@/modules/board/lib/boardConfigChangeset'

export function buildExportXmlFilename(boardName: string | undefined): string {
  const slug = (boardName ?? 'board')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'board'}-refloat-config.xml`
}

export function resolveReviewModalState<TEntry>(params: {
  reviewOpen: boolean
  hasImportPlan: boolean
  canEdit: boolean
  applyError: string | null
  reviewEntries: TEntry[]
  importReviewEntries: TEntry[]
}) {
  const visible = params.reviewOpen || params.hasImportPlan
  return {
    visible,
    source: params.hasImportPlan ? ('import' as const) : ('app' as const),
    entries: params.hasImportPlan ? params.importReviewEntries : params.reviewEntries,
    error:
      params.applyError ??
      (!params.canEdit && visible ? 'Board disconnected. Reconnect to apply changes.' : null),
  }
}

interface UseBoardConfigXmlTransferOptions {
  boardId: string | undefined
  boardName: string | undefined
  canEdit: boolean
  currentValues: Readonly<Record<string, number | boolean | undefined>> | undefined
  schema: BoardConfigSchema | null
  refloatBaseVersion: string | null | undefined
  temperatureUnit: TemperatureUnit
  onCloseOptions: () => void
  onResetApplyError: () => void
}

export function useBoardConfigXmlTransfer({
  boardId,
  boardName,
  canEdit,
  currentValues,
  schema,
  refloatBaseVersion,
  temperatureUnit,
  onCloseOptions,
  onResetApplyError,
}: UseBoardConfigXmlTransferOptions) {
  const [importPlan, setImportPlan] = useState<BoardConfigXmlImportPlan | null>(null)
  const [xmlNotice, setXmlNotice] = useState<string | null>(null)
  const [xmlError, setXmlError] = useState<string | null>(null)
  const [xmlBusy, setXmlBusy] = useState(false)

  const importReviewEntries = useMemo(
    () =>
      currentValues && importPlan
        ? buildBoardConfigReviewEntries({
            changes: importPlan.changes,
            currentValues,
            schema,
            refloatBaseVersion,
            temperatureUnit,
          })
        : [],
    [currentValues, importPlan, refloatBaseVersion, schema, temperatureUnit],
  )

  const handleExportXml = useCallback(async () => {
    if (!boardId || !canEdit || xmlBusy) return
    onCloseOptions()
    setXmlBusy(true)
    setXmlError(null)
    setXmlNotice(null)
    try {
      const xml = await exportBoardConfigXml(boardId)
      const file = new File(Paths.cache, buildExportXmlFilename(boardName))
      file.write(xml)
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/xml',
        dialogTitle: 'Export VESC XML config',
        UTI: 'public.xml',
      })
    } catch (err) {
      setXmlError(errorMessage(err, 'Board configuration XML could not be exported.'))
    } finally {
      setXmlBusy(false)
    }
  }, [boardId, boardName, canEdit, onCloseOptions, xmlBusy])

  const handleImportXml = useCallback(async () => {
    if (!boardId || !canEdit || xmlBusy) return
    onCloseOptions()
    setXmlBusy(true)
    setXmlError(null)
    setXmlNotice(null)
    onResetApplyError()
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/xml', 'text/xml', '*/*'],
        copyToCacheDirectory: true,
      })
      if (result.canceled) return
      const asset = result.assets[0]
      if (!asset?.uri) throw new Error('No XML file selected.')
      const xml = await new File(asset.uri).text()
      const plan = await planBoardConfigXmlImport(boardId, xml)
      if (Object.keys(plan.changes).length === 0 && plan.skippedFields.length === 0) {
        setXmlNotice('Board already matches this XML config.')
        return
      }
      setImportPlan(plan)
    } catch (err) {
      setXmlError(errorMessage(err, 'Board configuration XML could not be imported.'))
    } finally {
      setXmlBusy(false)
    }
  }, [boardId, canEdit, onCloseOptions, onResetApplyError, xmlBusy])

  const clearImportPlan = useCallback(() => {
    setImportPlan(null)
  }, [])

  return {
    importPlan,
    importReviewEntries,
    xmlNotice,
    xmlError,
    xmlBusy,
    setXmlNotice,
    clearImportPlan,
    handleExportXml,
    handleImportXml,
  }
}
