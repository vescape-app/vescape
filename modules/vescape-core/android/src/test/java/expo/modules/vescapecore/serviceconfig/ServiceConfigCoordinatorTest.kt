package expo.modules.vescapecore.serviceconfig

import expo.modules.vescapecore.appstatus.AppStatusTransport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Service Config resolution: persisted answer over the baked seed, failures keep what is known, and a
 * successful answer replaces the config whole.
 * @parity /modules/vescape-core/ios/serviceconfig/ServiceConfigTests.swift
 */
class ServiceConfigCoordinatorTest {
  private class RecordingTransport : AppStatusTransport {
    val urls = mutableListOf<String>()
    private val pending = mutableListOf<(String?) -> Unit>()

    override fun fetch(url: String, appVersion: String, deviceToken: String?, onResult: (String?) -> Unit) {
      urls.add(url)
      pending.add(onResult)
    }

    fun resolveAll(body: String?) {
      val callbacks = pending.toList()
      pending.clear()
      callbacks.forEach { it(body) }
    }
  }

  private class MemoryPersistence(var body: String? = null) : ServiceConfigPersistence {
    override fun read(): String? = body
    override fun write(body: String) { this.body = body }
  }

  private val seed = ServiceConfig(mapboxToken = "pk.seed", mapyToken = "mapy-seed")

  private fun coordinator(transport: AppStatusTransport, persistence: ServiceConfigPersistence) =
    ServiceConfigCoordinator("0.90.0", "https://api.vescape.app", transport, persistence, seed)

  @Test
  fun `starts from the baked seed when nothing is persisted`() {
    assertEquals(seed, coordinator(RecordingTransport(), MemoryPersistence()).current)
  }

  @Test
  fun `a persisted answer wins over the seed, including a service it leaves out`() {
    val persisted = MemoryPersistence("""{"tokens":{"mapbox":"pk.server"}}""")

    val current = coordinator(RecordingTransport(), persisted).current

    assertEquals("pk.server", current.mapboxToken)
    assertNull(current.mapyToken)
  }

  @Test
  fun `a successful refresh persists, replaces, and notifies once`() {
    val transport = RecordingTransport()
    val persistence = MemoryPersistence()
    val coordinator = coordinator(transport, persistence)
    val seen = mutableListOf<ServiceConfig>()
    coordinator.addChangeListener { seen.add(it) }

    coordinator.refresh()
    coordinator.refresh()
    transport.resolveAll("""{"tokens":{"mapbox":"pk.server","mapy":"mapy-server"}}""")

    assertEquals(listOf("https://api.vescape.app/api/service-config"), transport.urls)
    assertEquals(listOf(ServiceConfig("pk.server", "mapy-server")), seen)
    assertEquals(ServiceConfig("pk.server", "mapy-server"), coordinator(transport, persistence).current)
  }

  @Test
  fun `a failed or malformed refresh keeps the known config`() {
    val transport = RecordingTransport()
    val persistence = MemoryPersistence()
    val coordinator = coordinator(transport, persistence)

    coordinator.refresh()
    transport.resolveAll(null)
    coordinator.refresh()
    transport.resolveAll("""{"error":"rate-limited"}""")

    assertEquals(seed, coordinator.current)
    assertNull(persistence.body)
  }
}
