package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.alerts.SoundSampleQueue
import org.junit.Assert.assertEquals
import org.junit.Test

class SoundSampleQueueHostTest {
  @Test fun failedAppSoundDoesNotBlockAnotherAlert() {
    val samples = SoundSampleQueue()
    val played = mutableListOf<String>()
    samples.enqueue(11) { played += "app" }
    samples.enqueue(22) { played += "alert" }

    samples.complete(11, success = false)
    samples.complete(22, success = true)

    assertEquals(listOf("alert"), played)
    assertEquals(SoundSampleQueue.State.FAILED, samples.state(11))
    assertEquals(SoundSampleQueue.State.READY, samples.state(22))
    samples.enqueue(11) { played += "late app" }
    samples.enqueue(22) { played += "late alert" }
    assertEquals(listOf("alert", "late alert"), played)
  }
}
