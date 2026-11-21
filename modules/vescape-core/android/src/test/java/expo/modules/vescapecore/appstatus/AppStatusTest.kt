package expo.modules.vescapecore.appstatus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/appstatus/AppStatusTests.swift
 */
class AppStatusTest {
  private fun body(version: String, messages: String = "[]") =
    """{"version":$version,"messages":$messages}"""

  private val currentVersion =
    """{"installed":"0.80.2","latest":"0.80.2","status":"current"}"""

  @Test
  fun `decodes a resolved update warning`() {
    val status = parseAppStatus(
      body("""{"installed":"0.70.0","latest":"0.80.2","status":"update-warning","message":"# Update"}"""),
    )

    assertEquals("0.70.0", status?.version?.installed)
    assertEquals("0.80.2", status?.version?.latest)
    assertEquals(AppVersionStatus.UPDATE_WARNING, status?.version?.status)
    assertEquals("# Update", status?.version?.message)
    assertEquals(emptyList<CommunityMessage>(), status?.messages)
  }

  @Test
  fun `decodes every resolved status slug`() {
    val slugs = mapOf(
      "current" to AppVersionStatus.CURRENT,
      "update-warning" to AppVersionStatus.UPDATE_WARNING,
      "online-blocked" to AppVersionStatus.ONLINE_BLOCKED,
      "app-blocked" to AppVersionStatus.APP_BLOCKED,
    )
    for ((slug, expected) in slugs) {
      val status = parseAppStatus(
        body("""{"installed":"0.1.0","latest":"0.80.2","status":"$slug"}"""),
      )
      assertEquals(expected, status?.version?.status)
    }
  }

  @Test
  fun `decodes community messages with and without an action`() {
    val status = parseAppStatus(
      body(
        currentVersion,
        """[
          {"id":"m1","type":"critical","title":"Relay outage","body":"Relay down",
           "action":{"type":"primary","label":"Status","url":"https://vescape.app/status"}},
          {"id":"m2","type":"info","body":"Hello"}
        ]""",
      ),
    )

    assertEquals(2, status?.messages?.size)
    assertEquals(CommunityMessageType.CRITICAL, status?.messages?.get(0)?.type)
    assertEquals(CommunityMessageActionType.PRIMARY, status?.messages?.get(0)?.action?.type)
    assertEquals("https://vescape.app/status", status?.messages?.get(0)?.action?.url)
    assertNull(status?.messages?.get(1)?.action)
    assertEquals("Relay outage", status?.messages?.get(0)?.title)
    assertNull(status?.messages?.get(1)?.title)
  }

  @Test
  fun `ignores unknown additive fields`() {
    val status = parseAppStatus(
      """{"version":{"installed":"0.80.2","latest":"0.80.2","status":"current","futureField":1},
          "messages":[{"id":"m1","type":"info","body":"Hi","futureField":true}],
          "futureSection":{"a":1}}""",
    )

    assertEquals(AppVersionStatus.CURRENT, status?.version?.status)
    assertEquals(1, status?.messages?.size)
  }

  @Test
  fun `rejects invalid required shapes`() {
    val invalid = listOf(
      "not json",
      """{"messages":[]}""",
      body("""{"latest":"0.80.2","status":"current"}"""),
      body("""{"installed":"0.80.2","status":"current"}"""),
      body("""{"installed":"0.80.2","latest":"0.80.2"}"""),
      body("""{"installed":"0.80.2","latest":"0.80.2","status":"retired"}"""),
      body("""{"installed":"","latest":"0.80.2","status":"current"}"""),
      body("""{"installed":1,"latest":"0.80.2","status":"current"}"""),
      body("""{"installed":"0.80.2","latest":"0.80.2","status":"current","message":42}"""),
    )

    for (json in invalid) assertNull("expected null for: $json", parseAppStatus(json))
  }

  @Test
  fun `an unusable messages field means no messages, never a failed status`() {
    val withoutMessages = listOf(
      """{"version":$currentVersion}""",
      body(currentVersion, "null"),
      body(currentVersion, """{"m1":"Hi"}"""),
    )

    for (json in withoutMessages) {
      val status = parseAppStatus(json)
      assertEquals("expected a resolved status for: $json", AppVersionStatus.CURRENT, status?.version?.status)
      assertEquals(emptyList<CommunityMessage>(), status?.messages)
    }
  }

  @Test
  fun `skips invalid individual messages without failing the whole status`() {
    val status = parseAppStatus(
      body(
        currentVersion,
        """[
          {"type":"info","body":"no id"},
          {"id":"ok","type":"warning","body":"valid"},
          {"id":"bad-type","type":"shout","body":"Hi"},
          {"id":"bad-action","type":"info","body":"Hi","action":{"type":"primary"}},
          {"id":"bad-title","type":"info","title":42,"body":"Hi"},
          {"id":"tertiary","type":"info","body":"Hi","action":{"type":"tertiary","label":"a","url":"b"}},
          "notAnObject"
        ]""",
      ),
    )

    assertEquals(AppVersionStatus.CURRENT, status?.version?.status)
    assertEquals(listOf("ok"), status?.messages?.map { it.id })
  }

  @Test
  fun `maps the bridge payload`() {
    val map = parseAppStatus(
      body(
        """{"installed":"0.70.0","latest":"0.80.2","status":"update-warning","message":"Update"}""",
        """[{"id":"m1","type":"warning","body":"Hi","action":{"type":"secondary","label":"Read","url":"https://vescape.app"}}]""",
      ),
    )?.toMap()

    assertEquals(
      mapOf(
        "installed" to "0.70.0",
        "latest" to "0.80.2",
        "status" to "update-warning",
        "message" to "Update",
      ),
      map?.get("version"),
    )
    assertEquals(
      listOf(
        mapOf(
          "id" to "m1",
          "type" to "warning",
          "title" to null,
          "body" to "Hi",
          "action" to mapOf("type" to "secondary", "label" to "Read", "url" to "https://vescape.app"),
        ),
      ),
      map?.get("messages"),
    )
  }
}
