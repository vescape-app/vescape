package expo.modules.vescapecore.appstatus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatusCoordinatorTests.swift
 */
class AppStatusCoordinatorTest {
  private class RecordingTransport : AppStatusTransport {
    val urls = mutableListOf<String>()
    val versions = mutableListOf<String>()
    val deviceTokens = mutableListOf<String?>()
    private val pending = mutableListOf<(String?) -> Unit>()

    val inFlight: Int get() = pending.size

    override fun fetch(
      url: String,
      appVersion: String,
      deviceToken: String?,
      onResult: (String?) -> Unit,
    ) {
      urls.add(url)
      versions.add(appVersion)
      deviceTokens.add(deviceToken)
      pending.add(onResult)
    }

    fun resolveAll(body: String?) {
      val callbacks = pending.toList()
      pending.clear()
      callbacks.forEach { it(body) }
    }
  }

  private fun coordinator(
    transport: AppStatusTransport,
    installedVersion: String = "0.70.0",
    deviceToken: String? = null,
  ) = AppStatusCoordinator(
    installedVersion = installedVersion,
    baseUrl = "https://api.vescape.app",
    transport = transport,
    deviceTokenProvider = { deviceToken },
  )

  private fun statusBody(status: String, latest: String = "0.80.2") =
    """{"version":{"installed":"0.70.0","latest":"$latest","status":"$status"},"messages":[]}"""

  @Test
  fun `requests the app status route with the installed marketing version`() {
    val transport = RecordingTransport()

    coordinator(transport).refresh()

    assertEquals(listOf("https://api.vescape.app/api/app-status"), transport.urls)
    assertEquals(listOf("0.70.0"), transport.versions)
  }

  @Test
  fun `optionally supplies the device token to app status`() {
    val transport = RecordingTransport()

    coordinator(transport, deviceToken = "device-token").refresh()

    assertEquals(listOf("device-token"), transport.deviceTokens)
  }

  @Test
  fun `duplicate foreground refreshes share one in-flight request`() {
    val transport = RecordingTransport()
    val coordinator = coordinator(transport)

    coordinator.refresh()
    coordinator.refresh()
    coordinator.refresh()

    assertEquals(1, transport.inFlight)
    assertEquals(1, transport.urls.size)

    transport.resolveAll(statusBody("current"))
    coordinator.refresh()
    assertEquals(2, transport.urls.size)
  }

  @Test
  fun `starts unknown and stays unknown when the first fetch fails`() {
    val transport = RecordingTransport()
    val coordinator = coordinator(transport)
    var changes = 0
    coordinator.addChangeListener { changes += 1 }

    assertNull(coordinator.current)
    coordinator.refresh()
    transport.resolveAll(null)

    assertNull(coordinator.current)
    assertEquals(0, changes)
  }

  @Test
  fun `an invalid response fails open exactly like a transport failure`() {
    val transport = RecordingTransport()
    val coordinator = coordinator(transport)

    coordinator.refresh()
    transport.resolveAll("""{"version":{"installed":"0.70.0"}}""")

    assertNull(coordinator.current)
  }

  @Test
  fun `a successful result survives a later failed refresh`() {
    val transport = RecordingTransport()
    val coordinator = coordinator(transport)
    val seen = mutableListOf<AppVersionStatus?>()
    coordinator.addChangeListener { seen.add(it?.version?.status) }

    coordinator.refresh()
    transport.resolveAll(statusBody("online-blocked"))
    assertEquals(AppVersionStatus.ONLINE_BLOCKED, coordinator.current?.version?.status)

    coordinator.refresh()
    transport.resolveAll(null)
    assertEquals(AppVersionStatus.ONLINE_BLOCKED, coordinator.current?.version?.status)
    assertEquals(listOf(AppVersionStatus.ONLINE_BLOCKED), seen)
  }

  @Test
  fun `a later success replaces the previous result`() {
    val transport = RecordingTransport()
    val coordinator = coordinator(transport)

    coordinator.refresh()
    transport.resolveAll(statusBody("update-warning"))
    coordinator.refresh()
    transport.resolveAll(statusBody("current", latest = "0.81.0"))

    assertEquals(AppVersionStatus.CURRENT, coordinator.current?.version?.status)
    assertEquals("0.81.0", coordinator.current?.version?.latest)
  }

  @Test
  fun `online capability fails open until a block lands`() {
    val transport = RecordingTransport()
    val coordinator = coordinator(transport)

    assertFalse(coordinator.onlineBlocked)

    coordinator.refresh()
    transport.resolveAll(statusBody("app-blocked"))
    assertTrue(coordinator.onlineBlocked)

    coordinator.refresh()
    transport.resolveAll(statusBody("current"))
    assertFalse(coordinator.onlineBlocked)
  }

  @Test
  fun `an unreadable installed version never fetches`() {
    val transport = RecordingTransport()

    coordinator(transport, installedVersion = "").refresh()

    assertTrue(transport.urls.isEmpty())
  }
}
