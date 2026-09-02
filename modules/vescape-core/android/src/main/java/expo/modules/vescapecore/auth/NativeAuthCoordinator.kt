package expo.modules.vescapecore.auth

import android.content.Context
import expo.modules.vescapecore.api.ApiResult
import expo.modules.vescapecore.api.AuthMode
import expo.modules.vescapecore.api.HttpMethod
import expo.modules.vescapecore.api.VescapeApi
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import expo.modules.vescapecore.sync.SyncCoordinator
import org.json.JSONObject

/**
 * Device Token lifecycle: verify a freshly exchanged credential, store it, revoke it. The HTTP
 * boundary itself belongs to [VescapeApi] so every native caller shares one credential and one 401
 * policy.
 *
 * @parity /modules/vescape-core/ios/auth/NativeAuthCoordinator.swift
 */
class NativeAuthCoordinator(private val context: Context) {
  private val store = DeviceCredentialStore(context)

  fun stateMap(): Map<String, Any?> {
    val credential = store.read()
    return mapOf(
      "state" to store.state().slug,
      "accountId" to credential?.accountId,
      "expiresAt" to credential?.expiresAt,
    )
  }

  /**
   * Verifies the exchanged token against the Account it claims before storing it. The token is not
   * in the store yet, so the call carries it explicitly.
   */
  suspend fun provision(
    serverUrl: String,
    token: String,
    accountId: String,
  ): Map<String, Any?> {
    val origin = serverUrl.trimEnd('/')
    val result = VescapeApi.forOrigin(context, origin).request(
      method = HttpMethod.GET,
      path = ACCOUNT_PATH,
      auth = AuthMode.Bearer(token),
    ) { body -> JSONObject(body).optString("id") }

    when (result) {
      is ApiResult.Ok ->
        check(result.value == accountId) { "Account verification mismatch" }
      // `VescapeApi` already rejected the stored credential and refreshed App Status.
      ApiResult.Unauthorized -> throw IllegalStateException("Device credential rejected")
      else -> throw IllegalStateException("Account verification failed ($result)")
    }

    // The database is claimed before the credential is stored: a second Account must not be able to
    // upload from a database full of the first Account's Boards, Ride History and locations. The
    // Rider confirms the destructive reset, and only then does [confirmAccountReset] finish this.
    if (!SyncCoordinator.get(context).bindAccount(accountId)) {
      return stateMap() + mapOf("accountChangeRequiresReset" to true)
    }

    store.write(DeviceCredential(origin, token, accountId, null))
    AppStatusCoordinator.get(context).refresh()
    SyncCoordinator.get(context).start()
    return stateMap()
  }

  /**
   * The Rider confirmed that all local app data is erased and cannot yet be restored.
   *
   * One ordered transition: stop the uploader, invalidate in-flight work, replace the app-data
   * database, clear Sync Cursors and pending Sync Actions, bind the fresh database to the new
   * Account, install the new Device Token, start the uploader. Cancelling never reaches here, so the
   * old database and Account binding stay untouched.
   */
  suspend fun confirmAccountReset(
    serverUrl: String,
    token: String,
    accountId: String,
  ): Map<String, Any?> {
    val origin = serverUrl.trimEnd('/')
    SyncCoordinator.get(context).resetForAccount(accountId)
    // The token is installed before the uploader starts: a loop running on the previous Account's
    // credential against the new Account's database is exactly what this ordering exists to prevent.
    store.write(DeviceCredential(origin, token, accountId, null))
    AppStatusCoordinator.get(context).refresh()
    SyncCoordinator.get(context).start()
    return stateMap()
  }

  /**
   * Revokes server-side before the local copy goes away. A `401` means the server already considers
   * it gone, which is the same end state.
   */
  suspend fun revoke() {
    val credential = store.read() ?: return
    val result = VescapeApi.forOrigin(context, credential.serverUrl).request(
      method = HttpMethod.DELETE,
      path = REVOKE_PATH,
      auth = AuthMode.Required,
    ) { }

    when (result) {
      is ApiResult.Ok, ApiResult.Unauthorized -> Unit
      else -> throw IllegalStateException("Device credential revocation failed ($result)")
    }
    store.clear()
  }

  fun clear() {
    store.clear()
    // Signing out stops the uploader but keeps the Account binding, so data recorded while signed
    // out stays protected from retention for the same Account.
    SyncCoordinator.get(context).stop()
  }

  companion object {
    private const val ACCOUNT_PATH = "/api/account"
    private const val REVOKE_PATH = "/api/auth/device-tokens/current"

    @Volatile private var instance: NativeAuthCoordinator? = null
    fun get(context: Context): NativeAuthCoordinator =
      instance ?: synchronized(this) {
        instance ?: NativeAuthCoordinator(context.applicationContext).also { instance = it }
      }
  }
}
