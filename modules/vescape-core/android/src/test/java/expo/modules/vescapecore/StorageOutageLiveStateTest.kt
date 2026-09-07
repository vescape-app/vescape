package expo.modules.vescapecore

import expo.modules.vescapecore.recording.RecordingStorageFailureKind
import org.junit.Assert.assertEquals
import org.junit.Test

class StorageOutageLiveStateTest {
  @Test fun `connected outage preserves Board and telemetry while adding failure`() {
    val telemetry = listOf(mapOf("capturedAt" to 42L, "speed" to 18.0))
    val live = mapOf<String, Any?>(
      "board" to mapOf(
        "phase" to "ready", "connectedBoardId" to "board-a", "bleId" to "ble-a",
        "recentTelemetry" to telemetry,
      ),
      "recording" to mapOf("enabled" to true, "failure" to null),
    )

    val outage = liveStateWithStorageFailure(live, RecordingStorageFailureKind.StorageUnavailable)
    val board = outage["board"] as Map<*, *>
    val recording = outage["recording"] as Map<*, *>
    assertEquals("ready", board["phase"])
    assertEquals("board-a", board["connectedBoardId"])
    assertEquals("ble-a", board["bleId"])
    assertEquals(telemetry, board["recentTelemetry"])
    assertEquals(
      mapOf("kind" to "storage_unavailable", "storageUnavailable" to true),
      recording["failure"],
    )
  }
}
