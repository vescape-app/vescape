import {
  resumeDeviceProvisioning,
  suspendDeviceProvisioning,
} from '@/modules/profile/lib/deviceProvisioning'

export type AccountDeletionResult = 'accepted' | 'credential-clear-failed' | 'delete-failed'

export async function stopAccountAndDelete({
  clearCredential,
  deleteAccount,
}: {
  clearCredential: () => void
  deleteAccount: () => Promise<void>
}): Promise<AccountDeletionResult> {
  await suspendDeviceProvisioning()
  try {
    clearCredential()
  } catch {
    resumeDeviceProvisioning()
    return 'credential-clear-failed'
  }
  try {
    await deleteAccount()
  } catch {
    resumeDeviceProvisioning()
    return 'delete-failed'
  }
  return 'accepted'
}

export async function stopAccountAndSignOut({
  revokeCredential,
  signOut,
}: {
  revokeCredential: () => Promise<void>
  signOut: () => Promise<void>
}): Promise<void> {
  await suspendDeviceProvisioning()
  try {
    await revokeCredential()
    await signOut()
  } catch (error) {
    resumeDeviceProvisioning()
    throw error
  }
}
