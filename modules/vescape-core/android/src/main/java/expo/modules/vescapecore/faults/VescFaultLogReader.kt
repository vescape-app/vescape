package expo.modules.vescapecore.faults

import java.io.ByteArrayOutputStream

/** Collects one manual VESC `faults` terminal response. Nothing is persisted or parsed.
 * @parity /modules/vescape-core/ios/faults/VescFaultLogReader.swift
 */
class VescFaultLogReader(
  private val startedAtMs: Long,
  val onSuccess: (String) -> Unit,
  val onError: (String, String) -> Unit,
) {
  private val buffer = ByteArrayOutputStream()
  private var lastChunkAtMs: Long? = null
  private var finished = false

  fun onPrintChunk(bytes: ByteArray, atMs: Long) {
    if (finished || bytes.isEmpty()) return
    buffer.write(bytes)
    lastChunkAtMs = atMs
  }

  fun poll(nowMs: Long): Boolean {
    if (finished) return true
    val last = lastChunkAtMs
    if (last != null && nowMs - last >= IDLE_BOUNDARY_MS) {
      finished = true
      onSuccess(String(buffer.toByteArray(), Charsets.UTF_8))
      return true
    }
    if (nowMs - startedAtMs < HARD_BOUND_MS) return false
    finished = true
    onError("VESC_FAULT_LOG_TIMEOUT", "Controller fault log did not finish")
    return true
  }

  fun cancel() {
    if (finished) return
    finished = true
    onError("VESC_FAULT_LOG_DISCONNECTED", "Board disconnected while reading controller fault log")
  }

  companion object {
    internal const val IDLE_BOUNDARY_MS = 500L
    internal const val HARD_BOUND_MS = 4_000L
    internal const val TICK_MS = 100L
  }
}
