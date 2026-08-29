package expo.modules.vescapecore.faults

import java.io.ByteArrayOutputStream

/** The bytes one terminal read collected, plus the honest statement about whether it finished. */
data class VescFaultRegisterRead(
  val reason: VescFaultRegisterReason,
  val status: VescFaultRegisterStatus,
  val raw: ByteArray,
  val text: String,
) {
  override fun equals(other: Any?): Boolean =
    other is VescFaultRegisterRead &&
      reason == other.reason &&
      status == other.status &&
      raw.contentEquals(other.raw)

  override fun hashCode(): Int = raw.contentHashCode() * 31 + reason.hashCode()
}

/**
 * Collects the `COMM_PRINT` frames answering one `faults` request and decides, on a bounded policy,
 * when the read is over.
 *
 * The VESC protocol has **no** completion frame for terminal output, so there are exactly two ways a
 * read can end and both are represented honestly:
 *
 * - **idle boundary** — at least one frame arrived and the controller then stayed quiet for
 *   [IDLE_BOUNDARY_MS]. The output settled: [VescFaultRegisterStatus.COMPLETE].
 * - **hard bound** — [HARD_BOUND_MS] elapsed since the request. Whatever arrived (possibly nothing)
 *   is kept as [VescFaultRegisterStatus.INCOMPLETE]. Completion is never synthesized on a timeout,
 *   because "nothing arrived" and "the register is empty" are different facts.
 *
 * Pure and clock-driven: the Board Session ticks [poll], nothing here schedules or sends.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultRegisterReader.swift
 */
class VescFaultRegisterReader(
  val boardId: String,
  val reason: VescFaultRegisterReason,
  private val startedAtMs: Long,
) {
  private val buffer = ByteArrayOutputStream()
  private var lastChunkAtMs: Long? = null
  private var finished = false

  /** Bytes of one `COMM_PRINT` payload, command byte (and any CAN wrapper) already stripped. */
  fun onPrintChunk(bytes: ByteArray, atMs: Long) {
    if (finished || bytes.isEmpty()) return
    buffer.write(bytes)
    lastChunkAtMs = atMs
  }

  /** True once [poll] has produced the read's result; further chunks are ignored. */
  val isFinished: Boolean
    get() = finished

  /**
   * @return the finished read, or null while the completion policy says to keep waiting.
   */
  fun poll(nowMs: Long): VescFaultRegisterRead? {
    if (finished) return null
    val last = lastChunkAtMs
    val settled = last != null && nowMs - last >= IDLE_BOUNDARY_MS
    val expired = nowMs - startedAtMs >= HARD_BOUND_MS
    if (!settled && !expired) return null
    finished = true
    val raw = buffer.toByteArray()
    return VescFaultRegisterRead(
      reason = reason,
      // A settled read is complete even if the hard bound landed in the same tick: the controller
      // did go quiet, which is the only completion signal the protocol offers.
      status = if (settled) VescFaultRegisterStatus.COMPLETE else VescFaultRegisterStatus.INCOMPLETE,
      raw = raw,
      text = String(raw, Charsets.UTF_8),
    )
  }

  /**
   * The Board Session ended before the policy resolved. Keeps the partial bytes as evidence and says
   * so — this can never become a complete read.
   */
  fun finishIncomplete(): VescFaultRegisterRead? {
    if (finished) return null
    finished = true
    val raw = buffer.toByteArray()
    return VescFaultRegisterRead(
      reason = reason,
      status = VescFaultRegisterStatus.INCOMPLETE,
      raw = raw,
      text = String(raw, Charsets.UTF_8),
    )
  }

  companion object {
    /** Quiet time after the last frame that counts as "the controller finished answering". */
    internal const val IDLE_BOUNDARY_MS = 500L

    /** Upper bound on one read, no matter what the link does. */
    internal const val HARD_BOUND_MS = 4_000L

    /** How often the Board Session should tick [poll] while a read is in flight. */
    internal const val TICK_MS = 100L
  }
}
