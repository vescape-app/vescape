package expo.modules.vescapecore.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class DeviceCredentialStoreTest {
  private class MemoryPersistence(
    var encoded: String? = null,
    var storedState: String? = null,
  ) : CredentialPersistence {
    var failuresRemaining = 0
    override fun credential() = encoded
    override fun state() = storedState
    override fun replace(credential: String?, state: String): Boolean {
      encoded = credential
      storedState = state
      return failuresRemaining-- <= 0
    }
  }

  private val codec = CredentialCodec { value, _ -> value }
  private val old = DeviceCredential("https://old.example", "old-token", "old-account", null)

  @Test fun `missing credential is quiet`() {
    assertNull(DeviceCredentialStore(MemoryPersistence(), codec).read())
  }

  @Test fun `malformed credential preserves stored bytes`() {
    val persistence = MemoryPersistence("not-json", DeviceCredentialState.READY.slug)
    assertThrows(Exception::class.java) { DeviceCredentialStore(persistence, codec).read() }
    assertEquals("not-json", persistence.encoded)
    assertEquals(DeviceCredentialState.READY.slug, persistence.storedState)
  }

  @Test fun `failed write restores the previous credential and state`() {
    val persistence = MemoryPersistence()
    val store = DeviceCredentialStore(persistence, codec)
    store.write(old)
    persistence.failuresRemaining = 1

    assertThrows(IOException::class.java) {
      store.write(DeviceCredential("https://new.example", "new-token", "new-account", null))
    }

    assertEquals(old, store.read())
    assertEquals(old, DeviceCredentialStore(persistence, codec).read())
    assertEquals(DeviceCredentialState.READY, store.state(store.read()))
  }

  @Test fun `failed delete restores credential and ready state`() {
    val persistence = MemoryPersistence()
    val store = DeviceCredentialStore(persistence, codec)
    store.write(old)
    persistence.failuresRemaining = 1

    assertThrows(IOException::class.java) { store.reject() }

    assertEquals(old, store.read())
    assertEquals(DeviceCredentialState.READY, store.state(store.read()))
  }

  @Test fun `failed expiry update preserves old credential`() {
    val persistence = MemoryPersistence()
    val store = DeviceCredentialStore(persistence, codec)
    store.write(old)
    persistence.failuresRemaining = 1

    assertThrows(IOException::class.java) { store.updateExpiry("tomorrow") }
    assertEquals(old, store.read())
  }

  @Test fun `failed rollback is retained beside the primary commit failure`() {
    val persistence = MemoryPersistence()
    val store = DeviceCredentialStore(persistence, codec)
    store.write(old)
    persistence.failuresRemaining = 2

    val error = assertThrows(CredentialRollbackException::class.java) { store.clear() }
    assertTrue(error.cause?.message!!.contains("clear"))
  }
}
