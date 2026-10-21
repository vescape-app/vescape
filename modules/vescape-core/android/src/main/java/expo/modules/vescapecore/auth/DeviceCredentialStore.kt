package expo.modules.vescapecore.auth

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.io.IOException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class DeviceCredential(
  val serverUrl: String,
  val token: String,
  val accountId: String,
  val expiresAt: String?,
)

enum class DeviceCredentialState(val slug: String) {
  UNAVAILABLE("unavailable"),
  READY("ready"),
  REJECTED("rejected"),
}

/**
 * Keystore-backed Device Token storage.
 * @parity /modules/vescape-core/ios/auth/DeviceCredentialStore.swift
 */
internal interface CredentialPersistence {
  fun credential(): String?
  fun state(): String?
  fun replace(credential: String?, state: String): Boolean
}

internal fun interface CredentialCodec {
  fun transform(value: String, encrypt: Boolean): String
}

internal class CredentialRollbackException(cause: IOException) :
  IOException("Could not restore device credential after failed commit", cause)

class DeviceCredentialStore internal constructor(
  private val persistence: CredentialPersistence,
  private val codec: CredentialCodec,
) {
  constructor(context: Context) : this(
    SharedPreferencesCredentialPersistence(
      context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE),
    ),
    AndroidCredentialCodec(),
  )

  fun read(): DeviceCredential? = synchronized(STORAGE_LOCK) {
    val encoded = persistence.credential() ?: return@synchronized null
    val json = JSONObject(codec.transform(encoded, false))
    DeviceCredential(
      serverUrl = json.getString("serverUrl"),
      token = json.getString("token"),
      accountId = json.getString("accountId"),
      expiresAt = json.optString("expiresAt").ifEmpty { null },
    )
  }

  fun write(credential: DeviceCredential) = synchronized(STORAGE_LOCK) {
    val json = JSONObject()
      .put("serverUrl", credential.serverUrl.trimEnd('/'))
      .put("token", credential.token)
      .put("accountId", credential.accountId)
      .put("expiresAt", credential.expiresAt ?: "")
    replace(codec.transform(json.toString(), true), DeviceCredentialState.READY, "store")
  }

  fun updateExpiry(expiresAt: String) = synchronized(STORAGE_LOCK) {
    val current = read() ?: return@synchronized
    write(current.copy(expiresAt = expiresAt))
  }

  fun reject() = synchronized(STORAGE_LOCK) {
    replace(null, DeviceCredentialState.REJECTED, "reject")
  }

  fun clear() = synchronized(STORAGE_LOCK) {
    replace(null, DeviceCredentialState.UNAVAILABLE, "clear")
  }

  fun state(credential: DeviceCredential?): DeviceCredentialState = synchronized(STORAGE_LOCK) {
    if (credential != null) DeviceCredentialState.READY
    else DeviceCredentialState.entries.firstOrNull {
      it.slug == persistence.state()
    }?.takeIf { it != DeviceCredentialState.READY } ?: DeviceCredentialState.UNAVAILABLE
  }

  private fun replace(encoded: String?, state: DeviceCredentialState, operation: String) {
    val oldCredential = persistence.credential()
    val oldState = persistence.state() ?: DeviceCredentialState.UNAVAILABLE.slug
    if (persistence.replace(encoded, state.slug)) return
    // SharedPreferences updates its process cache before commit() reports disk failure. Restore the
    // prior pair so readers in this process and a recreated store observe the same old state.
    val primary = IOException("Could not $operation device credential")
    if (!persistence.replace(oldCredential, oldState)) {
      throw CredentialRollbackException(primary)
    }
    throw primary
  }

  companion object {
    internal const val PREFERENCES = "vescape_device_auth"
    internal const val CREDENTIAL = "credential"
    internal const val STATE = "state"
    private val STORAGE_LOCK = Any()
  }
}

private class SharedPreferencesCredentialPersistence(
  private val preferences: SharedPreferences,
) : CredentialPersistence {
  override fun credential(): String? = preferences.getString(DeviceCredentialStore.CREDENTIAL, null)
  override fun state(): String? = preferences.getString(DeviceCredentialStore.STATE, null)
  override fun replace(credential: String?, state: String): Boolean = preferences.edit().run {
    if (credential == null) remove(DeviceCredentialStore.CREDENTIAL)
    else putString(DeviceCredentialStore.CREDENTIAL, credential)
    putString(DeviceCredentialStore.STATE, state)
    commit()
  }
}

private class AndroidCredentialCodec : CredentialCodec {
  override fun transform(value: String, encrypt: Boolean): String {
    if (encrypt) {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, key())
      val packed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
      return Base64.encodeToString(packed, Base64.NO_WRAP)
    }
    val packed = Base64.decode(value, Base64.NO_WRAP)
    require(packed.size > IV_BYTES) { "Stored credential is truncated" }
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(
      Cipher.DECRYPT_MODE,
      key(),
      GCMParameterSpec(TAG_BITS, packed.copyOfRange(0, IV_BYTES)),
    )
    return String(cipher.doFinal(packed.copyOfRange(IV_BYTES, packed.size)), Charsets.UTF_8)
  }

  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(
        KeyGenParameterSpec.Builder(
          KEY_ALIAS,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .build(),
      )
      generateKey()
    }
  }

  companion object {
    private const val KEY_ALIAS = "vescape_device_auth_key"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
  }
}
