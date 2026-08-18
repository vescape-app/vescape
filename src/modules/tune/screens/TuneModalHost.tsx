import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { InfoModal } from '@/components/modals/InfoModal'
import { TextPromptModal } from '@/components/modals/TextPromptModal'
import { BoardPickerModal } from '@/modules/tune/components/BoardPickerModal'
import { FieldEditorPopover } from '@/modules/tune/components/FieldEditorPopover'
import { TuneProfileMetadataModal } from '@/modules/tune/components/TuneProfileMetadataModal'
import type { useTuneModals } from '@/modules/tune/hooks/useTuneModals'
import type { TuneProfileColorId, TuneProfileIconId } from '@/modules/tune/lib/profileMetadata'

/** Every modal the Tune screen can raise, driven by one `useTuneModals` state bag. */
export function TuneModalHost({ modals }: { modals: ReturnType<typeof useTuneModals> }) {
  return (
    <>
      <InfoModal
        visible={modals.infoModal != null}
        title={modals.infoModal?.title ?? ''}
        message={modals.infoModal?.message ?? ''}
        onDismiss={() => modals.setInfoModal(null)}
      />

      <FieldEditorPopover
        target={modals.editor}
        onCancel={modals.closeEditor}
        onApply={modals.handleEditorApply}
      />

      <TuneProfileMetadataModal
        visible={modals.createModalOpen}
        title="New Profile"
        confirmLabel="Create"
        initialValue={{
          name: '',
          icon: modals.defaultTuneIcon as TuneProfileIconId,
          color: modals.defaultTuneColor as TuneProfileColorId,
        }}
        onConfirm={({ name, icon, color }) => {
          void modals.storeCreateProfile(name, icon, color, modals.createCloneFromId)
          modals.setCreateModalOpen(false)
        }}
        onDismiss={() => modals.setCreateModalOpen(false)}
      />

      <TuneProfileMetadataModal
        visible={modals.metadataModalProfile != null}
        title="Edit Profile"
        confirmLabel="Save"
        initialValue={{
          name: modals.metadataModalProfile?.name ?? '',
          icon: modals.metadataModalProfile?.icon as TuneProfileIconId | undefined,
          color: modals.metadataModalProfile?.color as TuneProfileColorId | undefined,
        }}
        onConfirm={({ name, icon, color }) => {
          if (modals.metadataModalProfile)
            void modals.storeRenameProfile(modals.metadataModalProfile.id, name, icon, color)
          modals.setMetadataModalProfile(null)
        }}
        onDismiss={() => modals.setMetadataModalProfile(null)}
      />

      <BoardPickerModal
        visible={modals.copySourceProfile != null && modals.copyTargetBoard == null}
        boards={modals.otherBoards}
        onSelect={modals.handleCopyToBoard}
        onDismiss={() => modals.setCopySourceProfile(null)}
      />

      <TextPromptModal
        visible={modals.copyTargetBoard != null}
        title={`Copy to ${modals.copyTargetBoard?.name ?? 'board'}`}
        placeholder="Profile name"
        initialValue={modals.copySourceProfile ? `${modals.copySourceProfile.name} (copy)` : ''}
        confirmLabel="Copy"
        onConfirm={modals.handleCopyConfirm}
        onDismiss={() => {
          modals.setCopyTargetBoard(null)
          modals.setCopySourceProfile(null)
        }}
      />

      <ConfirmModal
        visible={modals.deleteConfirmProfile != null}
        title="Delete Profile"
        message={`Delete "${modals.deleteConfirmProfile?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (modals.deleteConfirmProfile)
            void modals.storeDeleteProfile(modals.deleteConfirmProfile.id)
          modals.setDeleteConfirmProfile(null)
        }}
        onCancel={() => modals.setDeleteConfirmProfile(null)}
      />
    </>
  )
}
