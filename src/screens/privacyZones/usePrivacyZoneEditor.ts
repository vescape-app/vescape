import { useCallback, useEffect, useRef, useState } from 'react'
import { useWindowDimensions } from 'react-native'
import type { Camera } from '@rnmapbox/maps'

import {
  generateZoneId,
  usePrivacyZoneStore,
  type PrivacyZone,
} from '@/modules/history/store/privacyZoneStore'
import {
  CIRCLE_DIAMETER_RATIO,
  DEFAULT_ZONE_ZOOM,
  currentLocation,
  radiusFromZoom,
  zoomFromRadius,
} from '@/screens/privacyZones/privacyZoneGeometry'
import { buildZonePills, type PendingCustomZone } from '@/screens/privacyZones/zonePills'

/**
 * Everything the Privacy Zones screen edits: which zone is selected, the camera that stands in for
 * its centre and radius, and the saves, renames and deletes that follow from them.
 */
export function usePrivacyZoneEditor() {
  const { width: screenWidth } = useWindowDimensions()
  const circleRadiusPx = (screenWidth * CIRCLE_DIAMETER_RATIO) / 2

  const zones = usePrivacyZoneStore((s) => s.zones)
  const loaded = usePrivacyZoneStore((s) => s.loaded)
  const storeLoad = usePrivacyZoneStore((s) => s.load)
  const storeSave = usePrivacyZoneStore((s) => s.save)
  const storeUpdate = usePrivacyZoneStore((s) => s.update)
  const storeRename = usePrivacyZoneStore((s) => s.rename)
  const storeToggle = usePrivacyZoneStore((s) => s.toggle)
  const storeRemove = usePrivacyZoneStore((s) => s.remove)

  const [selectedId, setSelectedId] = useState<string>('home')
  const [pendingCustom, setPendingCustom] = useState<PendingCustomZone | null>(null)

  const [cameraCenter, setCameraCenter] = useState<[number, number]>(currentLocation)
  const [cameraZoom, setCameraZoom] = useState(DEFAULT_ZONE_ZOOM)

  const [addNameVisible, setAddNameVisible] = useState(false)
  const [addNameText, setAddNameText] = useState('')
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [renameText, setRenameText] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const editStartRef = useRef<{ center: [number, number]; zoom: number } | null>(null)

  const cameraRef = useRef<Camera>(null)
  const prevSelectedRef = useRef<string | null>(null)
  useEffect(() => {
    void storeLoad()
  }, [storeLoad])

  const savedZoneForId = useCallback(
    (id: string): PrivacyZone | undefined => {
      if (id === 'home') return zones.find((z) => z.preset === 'home')
      if (id === 'work') return zones.find((z) => z.preset === 'work')
      return zones.find((z) => z.id === id)
    },
    [zones],
  )

  const flyToZone = useCallback(
    (id: string, animationDuration: number) => {
      const saved = savedZoneForId(id)
      if (saved) {
        const zoom = zoomFromRadius(saved.radiusMeters, circleRadiusPx, saved.centerLatitude)
        const center: [number, number] = [saved.centerLongitude, saved.centerLatitude]
        const zoomLevel = Math.max(10, Math.min(19, zoom))
        setCameraCenter(center)
        setCameraZoom(zoomLevel)
        cameraRef.current?.setCamera({
          centerCoordinate: center,
          zoomLevel,
          animationDuration,
        })
      } else {
        const center = currentLocation()
        setCameraCenter(center)
        setCameraZoom(DEFAULT_ZONE_ZOOM)
        cameraRef.current?.setCamera({
          centerCoordinate: center,
          zoomLevel: DEFAULT_ZONE_ZOOM,
          animationDuration,
        })
      }
    },
    [circleRadiusPx, savedZoneForId],
  )

  useEffect(() => {
    if (!loaded || !mapReady) return
    const isInitial = prevSelectedRef.current === null
    if (isInitial || prevSelectedRef.current !== selectedId) {
      prevSelectedRef.current = selectedId
      flyToZone(selectedId, 0)
    }
  }, [selectedId, loaded, mapReady, flyToZone])

  const handleCameraChanged = useCallback(
    (state: { properties: { center: number[]; zoom: number } }) => {
      const [lon, lat] = state.properties.center
      setCameraCenter([lon, lat])
      setCameraZoom(state.properties.zoom)
    },
    [],
  )

  const handleSelectPill = useCallback((id: string) => {
    setSelectedId(id)
    setIsEditing(false)
  }, [])

  const handleAddPress = useCallback(() => {
    setAddNameText('')
    setAddNameVisible(true)
  }, [])

  const handleAddConfirm = useCallback(() => {
    const name = addNameText.trim()
    if (!name) return
    const id = generateZoneId()
    setPendingCustom({ id, name })
    setSelectedId(id)
    setAddNameVisible(false)
  }, [addNameText])

  const handleRenamePress = useCallback((id: string, currentName: string) => {
    setRenameText(currentName)
    setRenameTarget({ id, name: currentName })
  }, [])

  const handleRenameConfirm = useCallback(async () => {
    if (!renameTarget) return
    const newName = renameText.trim()
    if (!newName) return
    const saved = savedZoneForId(renameTarget.id)
    if (saved) {
      await storeRename(renameTarget.id, newName)
    } else if (pendingCustom?.id === renameTarget.id) {
      setPendingCustom((p) => (p ? { ...p, name: newName } : null))
    }
    setRenameTarget(null)
  }, [renameTarget, renameText, savedZoneForId, storeRename, pendingCustom])

  const handleDeletePress = useCallback((id: string) => {
    setConfirmDeleteId(id)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDeleteId) return
    if (pendingCustom?.id === confirmDeleteId) {
      setPendingCustom(null)
      setSelectedId('home')
    } else {
      await storeRemove(confirmDeleteId)
      setSelectedId('home')
    }
    setConfirmDeleteId(null)
  }, [confirmDeleteId, pendingCustom, storeRemove])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const [lon, lat] = cameraCenter
      const radius = Math.round(radiusFromZoom(cameraZoom, circleRadiusPx, lat))
      if (selectedId === 'home') {
        await storeSave('home', 'home', 'Home', lat, lon, radius)
      } else if (selectedId === 'work') {
        await storeSave('work', 'work', 'Work', lat, lon, radius)
      } else if (pendingCustom?.id === selectedId) {
        const { id, name } = pendingCustom
        setPendingCustom(null)
        await storeSave(id, 'custom', name, lat, lon, radius)
      }
      setIsEditing(false)
    } finally {
      setSaving(false)
    }
  }, [cameraCenter, cameraZoom, circleRadiusPx, selectedId, pendingCustom, storeSave])

  const handleUpdate = useCallback(async () => {
    setSaving(true)
    try {
      const [lon, lat] = cameraCenter
      const radius = Math.round(radiusFromZoom(cameraZoom, circleRadiusPx, lat))
      await storeUpdate(selectedId, lat, lon, radius)
      setIsEditing(false)
    } finally {
      setSaving(false)
    }
  }, [cameraCenter, cameraZoom, circleRadiusPx, selectedId, storeUpdate])

  const handleToggle = useCallback(async () => {
    const zone = savedZoneForId(selectedId)
    if (!zone) return
    await storeToggle(zone.id)
  }, [selectedId, savedZoneForId, storeToggle])

  const handleStartEdit = useCallback(() => {
    editStartRef.current = { center: cameraCenter, zoom: cameraZoom }
    setIsEditing(true)
  }, [cameraCenter, cameraZoom])

  const handleCancelEdit = useCallback(() => {
    const snap = editStartRef.current
    if (snap) {
      cameraRef.current?.setCamera({
        centerCoordinate: snap.center,
        zoomLevel: snap.zoom,
        animationDuration: 300,
      })
    }
    setIsEditing(false)
  }, [])

  const pills = buildZonePills(zones, pendingCustom)
  const savedZone = savedZoneForId(selectedId)
  const isUnsaved =
    !savedZone &&
    (selectedId === 'home' || selectedId === 'work' || pendingCustom?.id === selectedId)

  return {
    screenWidth,
    circleDiameter: screenWidth * CIRCLE_DIAMETER_RATIO,
    cameraRef,
    cameraCenter,
    cameraZoom,
    loaded,
    saving,
    isEditing,
    isUnsaved,
    pills,
    selectedId,
    zoneEnabled: savedZone?.enabled ?? false,
    addNameVisible,
    addNameText,
    renameTarget,
    renameText,
    confirmDeleteId,
    setAddNameVisible,
    setAddNameText,
    setRenameTarget,
    setRenameText,
    setConfirmDeleteId,
    setMapReady,
    handleCameraChanged,
    handleSelectPill,
    handleAddPress,
    handleAddConfirm,
    handleRenamePress,
    handleRenameConfirm,
    handleDeletePress,
    handleDeleteConfirm,
    handleSave,
    handleUpdate,
    handleToggle,
    handleStartEdit,
    handleCancelEdit,
  }
}
