package expo.modules.vescapecore.alerts

/** Queues playback by sample, so a failed load cannot hold unrelated sounds. */
internal class SoundSampleQueue {
  enum class State { PENDING, READY, FAILED }

  private val states = HashMap<Int, State>()
  private val pending = HashMap<Int, MutableList<() -> Unit>>()

  fun reset() {
    states.clear()
    pending.clear()
  }

  fun takePending(): List<() -> Unit> = pending.values.flatten().also { pending.clear() }

  fun state(sampleId: Int): State = if (sampleId == 0) State.FAILED else states[sampleId] ?: State.PENDING

  fun enqueue(sampleId: Int, play: () -> Unit) {
    when (state(sampleId)) {
      State.READY -> play()
      State.PENDING -> pending.getOrPut(sampleId, ::ArrayList).add(play)
      State.FAILED -> Unit
    }
  }

  fun complete(sampleId: Int, success: Boolean) {
    states[sampleId] = if (success) State.READY else State.FAILED
    val waiting = pending.remove(sampleId).orEmpty()
    if (success) waiting.forEach { it() }
  }
}
