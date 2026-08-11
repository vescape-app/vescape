import Mapbox, { Camera, MapView } from '@rnmapbox/maps'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'
import { Text } from '@/components/base/Text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from 'expo-router'
import { theme } from '@/constants/theme'
import { Input } from '@/components/forms/Input'

import { Button } from '@/components/base/Button'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { MAPBOX_ACCESS_TOKEN } from '@/config/mapy'
import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'
import { ONE_DARK_MAP_STYLE } from '@/modules/map/constants/oneDarkMapStyle'
import { BriefcaseIcon, HouseIcon, PencilSimpleIcon, TrashIcon } from 'phosphor-react-native'
import type { Icon } from 'phosphor-react-native'
import {
  PillSelectorItem,
  PillSelectorAdd,
  PillSelectorDot,
  PillSelectorMenuItem,
  PillSelector,
} from '@/components/controls/PillSelector'
import {
  generateZoneId,
  usePrivacyZoneStore,
  type PrivacyZone,
} from '@/modules/history/store/privacyZoneStore'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'

Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN)

interface ZonePill {
  id: string
  name: string
  isBuiltIn: boolean
  isSaved: boolean
  enabled: boolean
  icon?: Icon
}

interface PendingCustomZone {
  id: string
  name: string
}

function buildZonePills(
  zones: PrivacyZone[],
  pendingCustom?: PendingCustomZone | null,
): ZonePill[] {
  const homeZone = zones.find((z) => z.preset === 'home')
  const workZone = zones.find((z) => z.preset === 'work')

  const pills: ZonePill[] = [
    {
      id: 'home',
      name: 'Home',
      isBuiltIn: true,
      isSaved: !!homeZone,
      enabled: homeZone?.enabled ?? false,
      icon: HouseIcon,
    },
    {
      id: 'work',
      name: 'Work',
      isBuiltIn: true,
      isSaved: !!workZone,
      enabled: workZone?.enabled ?? false,
      icon: BriefcaseIcon,
    },
  ]

  for (const z of zones) {
    if (z.preset === 'custom') {
      pills.push({ id: z.id, name: z.name, isBuiltIn: false, isSaved: true, enabled: z.enabled })
    }
  }

  if (pendingCustom && !zones.some((z) => z.id === pendingCustom.id)) {
    pills.push({
      id: pendingCustom.id,
      name: pendingCustom.name,
      isBuiltIn: false,
      isSaved: false,
      enabled: false,
    })
  }

  return pills
}

const DEFAULT_ZONE_ZOOM = 15
const CIRCLE_DIAMETER_RATIO = 0.6
const HEADER_HEIGHT = Platform.OS === 'android' ? 56 : 44

function radiusFromZoom(zoom: number, circleRadiusPx: number, latitude: number): number {
  const mpp = (40_075_016 * Math.cos((latitude * Math.PI) / 180)) / (256 * Math.pow(2, zoom))
  return mpp * circleRadiusPx
}

function zoomFromRadius(radiusM: number, circleRadiusPx: number, latitude: number): number {
  const numerator = 40_075_016 * Math.cos((latitude * Math.PI) / 180) * circleRadiusPx
  return Math.log2(numerator / (256 * radiusM))
}

function currentLocation(): [number, number] {
  const snap = liveTelemetryRuntime.getSnapshot()
  const loc = snap.latestApproximateLocation
  if (loc) return [loc.longitude, loc.latitude]
  return MAP_DEFAULTS.fallbackCoordinate
}

export default function PrivacyZonesScreen() {
  const { width: screenWidth } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const circleRadiusPx = (screenWidth * CIRCLE_DIAMETER_RATIO) / 2

  useLayoutEffect(() => {
    navigation.setOptions({ headerTransparent: true })
  }, [navigation])

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

  const zoneEnabled = savedZone?.enabled ?? false
  const toggleLabel = zoneEnabled ? 'Disable' : 'Enable'
  const circleDiameter = screenWidth * CIRCLE_DIAMETER_RATIO
  const pillsTop = insets.top + HEADER_HEIGHT

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFill}
        styleJSON={ONE_DARK_MAP_STYLE}
        onCameraChanged={handleCameraChanged}
        onDidFinishLoadingMap={() => setMapReady(true)}
        scaleBarEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
        compassEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        scrollEnabled={isEditing || isUnsaved}
        zoomEnabled={isEditing || isUnsaved}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: cameraCenter,
            zoomLevel: cameraZoom,
          }}
          animationMode="none"
        />
      </MapView>

      <View style={styles.circleWrapper} pointerEvents="none">
        <View
          style={[
            styles.circle,
            {
              width: circleDiameter,
              height: circleDiameter,
              borderRadius: circleDiameter / 2,
            },
            zoneEnabled || isUnsaved ? styles.circleEnabled : styles.circleDisabled,
          ]}
        />
      </View>

      <View style={styles.zoneLabelWrapper} pointerEvents="none">
        <Text style={styles.zoneLabel}>{pills.find((p) => p.id === selectedId)?.name ?? ''}</Text>
      </View>

      <View style={[styles.pillsFloating, { top: pillsTop }]}>
        <PillSelector activeId={selectedId} centered>
          {pills.map((pill) => {
            const testIdSuffix = !pill.isSaved && !pill.isBuiltIn ? 'pending-custom' : pill.id
            return (
              <PillSelectorItem
                key={pill.id}
                id={pill.id}
                label={pill.name}
                icon={pill.icon}
                labelBehavior="always"
                testID={`privacy-zone-pill-${testIdSuffix}`}
                badge={
                  <PillSelectorDot
                    status={!pill.isSaved ? 'draft' : pill.enabled ? 'enabled' : 'disabled'}
                  />
                }
                color={theme.palette.green}
                onPress={() => handleSelectPill(pill.id)}
              >
                {!pill.isBuiltIn ? (
                  <PillSelectorMenuItem
                    icon={PencilSimpleIcon}
                    label="Rename"
                    testID={`privacy-zone-menu-rename-${testIdSuffix}`}
                    onPress={() => handleRenamePress(pill.id, pill.name)}
                  />
                ) : null}
                {pill.isSaved || !pill.isBuiltIn ? (
                  <PillSelectorMenuItem
                    icon={TrashIcon}
                    label="Delete"
                    testID={`privacy-zone-menu-delete-${testIdSuffix}`}
                    onPress={() => handleDeletePress(pill.id)}
                    danger
                    separator={!pill.isBuiltIn}
                  />
                ) : null}
              </PillSelectorItem>
            )
          })}
          <PillSelectorAdd testID="privacy-zone-add-button" onPress={handleAddPress} />
        </PillSelector>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        {isUnsaved ? (
          <Button
            label="Save and enable"
            testID="privacy-zone-save-button"
            onPress={() => void handleSave()}
            loading={saving}
            style={styles.actionButton}
          />
        ) : isEditing ? (
          <View style={styles.savedActions}>
            <Button
              label="Cancel"
              testID="privacy-zone-edit-cancel-button"
              variant="secondary"
              onPress={handleCancelEdit}
              style={styles.actionButton}
            />
            <Button
              label="Save changes"
              testID="privacy-zone-save-button"
              onPress={() => void handleUpdate()}
              loading={saving}
              style={styles.actionButton}
            />
          </View>
        ) : (
          <View style={styles.savedActions}>
            <Button
              label="Change zone"
              testID="privacy-zone-change-button"
              variant="secondary"
              onPress={handleStartEdit}
              style={styles.actionButton}
            />
            <Button
              key={toggleLabel}
              label={toggleLabel}
              testID="privacy-zone-toggle-button"
              variant={zoneEnabled ? 'secondary' : 'primary'}
              onPress={() => void handleToggle()}
              style={styles.actionButton}
            />
          </View>
        )}
      </View>

      {!loaded ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={theme.palette.green.color} />
        </View>
      ) : null}

      <Modal
        visible={addNameVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddNameVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setAddNameVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>Zone name</Text>
            <Input
              testID="privacy-zone-name-input"
              style={styles.modalInput}
              value={addNameText}
              onChangeText={setAddNameText}
              placeholder="e.g. Gym, Work 2"
              placeholderTextColor={theme.palette.slate.textDim}
              autoFocus
              maxLength={32}
              onSubmitEditing={handleAddConfirm}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <Button
                label="Cancel"
                testID="privacy-zone-name-cancel-button"
                variant="secondary"
                onPress={() => setAddNameVisible(false)}
                style={styles.modalButton}
              />
              <Button
                label="Add"
                testID="privacy-zone-name-add-button"
                onPress={handleAddConfirm}
                disabled={!addNameText.trim()}
                style={styles.modalButton}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={renameTarget != null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setRenameTarget(null)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>Rename zone</Text>
            <Input
              testID="privacy-zone-rename-input"
              style={styles.modalInput}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="Zone name"
              placeholderTextColor={theme.palette.slate.textDim}
              autoFocus
              maxLength={32}
              onSubmitEditing={() => void handleRenameConfirm()}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <Button
                label="Cancel"
                testID="privacy-zone-rename-cancel-button"
                variant="secondary"
                onPress={() => setRenameTarget(null)}
                style={styles.modalButton}
              />
              <Button
                label="Save"
                testID="privacy-zone-rename-save-button"
                onPress={() => void handleRenameConfirm()}
                disabled={!renameText.trim()}
                style={styles.modalButton}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmModal
        visible={confirmDeleteId != null}
        title="Delete zone"
        message="This zone will be removed and recording will resume in this area."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.palette.slate.bg,
  },
  pillsFloating: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  circleWrapper: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    borderWidth: 2,
  },
  circleEnabled: {
    backgroundColor: theme.zone.bg,
    borderColor: theme.zone.border,
  },
  circleDisabled: {
    backgroundColor: 'transparent',
    borderColor: theme.zone.borderDim,
  },
  zoneLabelWrapper: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneLabel: {
    color: theme.palette.slate.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    textShadowColor: theme.alpha(theme.palette.mono.black, 0.85),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha(theme.palette.slate.bg, 0.6),
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  actionButton: {
    flex: 1,
  },
  savedActions: {
    flexDirection: 'row',
    gap: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.6),
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    padding: 20,
    gap: 16,
  },
  modalTitle: {
    color: theme.palette.slate.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  modalInput: {
    borderRadius: 10,
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalButton: {
    flex: 1,
  },
})
