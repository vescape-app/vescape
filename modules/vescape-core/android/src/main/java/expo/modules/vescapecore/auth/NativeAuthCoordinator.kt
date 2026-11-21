package expo.modules.vescapecore.auth

import android.content.Context
import expo.modules.vescapecore.api.ApiResult
import expo.modules.vescapecore.api.AuthMode
import expo.modules.vescapecore.api.HttpMethod
import expo.modules.vescapecore.api.VescapeApi
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import org.json.JSONObject

/**
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
      ApiResult.Unauthorized -> throw IllegalStateException("Device credential rejected")
      else -> throw IllegalStateException("Account verification failed ($result)")
    }

    store.write(DeviceCredential(origin, token, accountId, null))
    AppStatusCoordinator.get(context).refresh()
    return stateMap()
  }

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
