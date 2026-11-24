import { useCallback, useMemo, useState } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import {
  applyBoardConfigChangeset,
  exportBoardConfigXml,
  planBoardConfigXmlImport,
  type BoardConfigSchema,
  type BoardConfigValues,
  type BoardConfigXmlImportPlan,
} from 'vescape-core'

import { errorMessage } from '@/helpers/error'
import type { TemperatureUnit } from '@/helpers/units'
import { buildBoardConfigReviewEntries } from '@/modules/board/lib/boardConfigChangeset'
import {
  buildExportXmlFilename,
  validateBoardConfigImportSchema,
} from '@/screens/board-config/boardConfigXmlHelpers'

export { resolveReviewModalState } from '@/screens/board-config/boardConfigXmlHelpers'

export async function applyReviewedBoardConfigChangeset(params: {
  boardId: string | undefined
  canEdit: boolean
  importPlan: BoardConfigXmlImportPlan | null
  pendingChanges: Record<string, number | boolean>
  currentSchemaHash: string | null | undefined
}): Promise<
  | { kind: 'noop' }
  | { kind: 'error'; message: string }
  | { kind: 'applied'; isImport: boolean; updated: BoardConfigValues }
> {
  const { importPlan } = params
  const targetChanges = importPlan !== null ? importPlan.changes : params.pendingChanges
  if (!params.boardId || Object.keys(targetChanges).length === 0) {
    return { kind: 'noop' }
  }
  if (!params.canEdit) {
    return { kind: 'error', message: 'Board disconnected. Reconnect to apply changes.' }
  }
  if (importPlan !== null) {
    const schemaError = validateBoardConfigImportSchema(importPlan, params.currentSchemaHash)
    if (schemaError) return { kind: 'error', message: schemaError }
  }
  try {
    const updated =
      importPlan !== null
        ? await applyBoardConfigChangeset(params.boardId, targetChanges, 'import')
        : await applyBoardConfigChangeset(params.boardId, targetChanges)
    return { kind: 'applied', isImport: importPlan !== null, updated }
  } catch (err) {
    return {
      kind: 'error',
      message: errorMessage(err, 'Board configuration could not be written.'),
    }
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
    canTransferXml: canEdit && !xmlBusy,
    setXmlNotice,
    clearImportPlan,
    handleExportXml,
    handleImportXml,
  }
}
