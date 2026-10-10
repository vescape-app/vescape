package expo.modules.vescapecore.auth

import android.content.Context
import expo.modules.vescapecore.api.ApiResult
import expo.modules.vescapecore.api.AuthMode
import expo.modules.vescapecore.api.HttpMethod
import expo.modules.vescapecore.api.VescapeApi
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
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
      "state" to store.state(credential).slug,
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

    store.write(DeviceCredential(origin, token, accountId, null))
    AppStatusCoordinator.get(context).refresh()
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

  fun clear() = store.clear()

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
