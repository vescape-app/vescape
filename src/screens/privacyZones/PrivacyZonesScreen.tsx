import Mapbox, { Camera, MapView } from '@rnmapbox/maps'
import { useNavigation } from 'expo-router'
import { PencilSimpleIcon, TrashIcon } from 'phosphor-react-native'
import { useLayoutEffect } from 'react'
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import {
  PillSelector,
  PillSelectorAdd,
  PillSelectorDot,
  PillSelectorItem,
  PillSelectorMenuItem,
} from '@/components/controls/PillSelector'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { MAPBOX_ACCESS_TOKEN } from '@/config/mapy'
import { theme } from '@/constants/theme'
import { ONE_DARK_MAP_STYLE } from '@/modules/map/constants/oneDarkMapStyle'
import { usePrivacyZoneEditor } from '@/screens/privacyZones/usePrivacyZoneEditor'
import { ZoneNameModal } from '@/screens/privacyZones/ZoneNameModal'

Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN)

const HEADER_HEIGHT = Platform.OS === 'android' ? 56 : 44

/** Areas where recording pauses. The map's camera is the editor: pan to move, zoom to resize. */
export function PrivacyZonesScreen() {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const editor = usePrivacyZoneEditor()

  useLayoutEffect(() => {
    navigation.setOptions({ headerTransparent: true })
  }, [navigation])

  const {
    circleDiameter,
    cameraRef,
    cameraCenter,
    cameraZoom,
    loaded,
    saving,
    isEditing,
    isUnsaved,
    pills,
    selectedId,
    zoneEnabled,
  } = editor
  const mapInteractive = isEditing || isUnsaved
  const toggleLabel = zoneEnabled ? 'Disable' : 'Enable'

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFill}
        styleJSON={ONE_DARK_MAP_STYLE}
        onCameraChanged={editor.handleCameraChanged}
        onDidFinishLoadingMap={() => editor.setMapReady(true)}
        scaleBarEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
        compassEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        scrollEnabled={mapInteractive}
        zoomEnabled={mapInteractive}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: cameraCenter, zoomLevel: cameraZoom }}
          animationMode="none"
        />
      </MapView>

      <View style={styles.circleWrapper} pointerEvents="none">
        <View
          style={[
            styles.circle,
            { width: circleDiameter, height: circleDiameter, borderRadius: circleDiameter / 2 },
            zoneEnabled || isUnsaved ? styles.circleEnabled : styles.circleDisabled,
          ]}
        />
      </View>

      <View style={styles.zoneLabelWrapper} pointerEvents="none">
        <Text style={styles.zoneLabel}>{pills.find((p) => p.id === selectedId)?.name ?? ''}</Text>
      </View>

      <View style={[styles.pillsFloating, { top: insets.top + HEADER_HEIGHT }]}>
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
                onPress={() => editor.handleSelectPill(pill.id)}
              >
                {!pill.isBuiltIn ? (
                  <PillSelectorMenuItem
                    icon={PencilSimpleIcon}
                    label="Rename"
                    testID={`privacy-zone-menu-rename-${testIdSuffix}`}
                    onPress={() => editor.handleRenamePress(pill.id, pill.name)}
                  />
                ) : null}
                {pill.isSaved || !pill.isBuiltIn ? (
                  <PillSelectorMenuItem
                    icon={TrashIcon}
                    label="Delete"
                    testID={`privacy-zone-menu-delete-${testIdSuffix}`}
                    onPress={() => editor.handleDeletePress(pill.id)}
                    danger
                    separator={!pill.isBuiltIn}
                  />
                ) : null}
              </PillSelectorItem>
            )
          })}
          <PillSelectorAdd testID="privacy-zone-add-button" onPress={editor.handleAddPress} />
        </PillSelector>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        {isUnsaved ? (
          <Button
            label="Save and enable"
            testID="privacy-zone-save-button"
            onPress={() => void editor.handleSave()}
            loading={saving}
            style={styles.actionButton}
          />
        ) : isEditing ? (
          <View style={styles.savedActions}>
            <Button
              label="Cancel"
              testID="privacy-zone-edit-cancel-button"
              variant="secondary"
              onPress={editor.handleCancelEdit}
              style={styles.actionButton}
            />
            <Button
              label="Save changes"
              testID="privacy-zone-save-button"
              onPress={() => void editor.handleUpdate()}
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
              onPress={editor.handleStartEdit}
              style={styles.actionButton}
            />
            <Button
              key={toggleLabel}
              label={toggleLabel}
              testID="privacy-zone-toggle-button"
              variant={zoneEnabled ? 'secondary' : 'primary'}
              onPress={() => void editor.handleToggle()}
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

      <ZoneNameModal
        visible={editor.addNameVisible}
        title="Zone name"
        value={editor.addNameText}
        confirmLabel="Add"
        testIdPrefix="privacy-zone-name"
        placeholder="e.g. Gym, Work 2"
        onChangeText={editor.setAddNameText}
        onConfirm={editor.handleAddConfirm}
        onCancel={() => editor.setAddNameVisible(false)}
      />

      <ZoneNameModal
        visible={editor.renameTarget != null}
        title="Rename zone"
        value={editor.renameText}
        confirmLabel="Save"
        testIdPrefix="privacy-zone-rename"
        placeholder="Zone name"
        onChangeText={editor.setRenameText}
        onConfirm={() => void editor.handleRenameConfirm()}
        onCancel={() => editor.setRenameTarget(null)}
      />

      <ConfirmModal
        visible={editor.confirmDeleteId != null}
        title="Delete zone"
        message="This zone will be removed and recording will resume in this area."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void editor.handleDeleteConfirm()}
        onCancel={() => editor.setConfirmDeleteId(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
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
    color: theme.neutral.textPrimary,
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
    backgroundColor: theme.alpha(theme.neutral.bg, 0.6),
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
})
