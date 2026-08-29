package expo.modules.vescapecore.faults

import android.content.Context
import expo.modules.vescapecore.telemetry.TelemetryDatabase
import expo.modules.vescapecore.telemetry.VescFaultCaptureEntity
import expo.modules.vescapecore.telemetry.VescFaultCaptureSampleEntity

/**
 * One decoded Board sample retained inside a VESC Fault Capture.
 *
 * A projection of the decoded telemetry map, not a Telemetry Sample: no GPS, no derived Ride
 * History fields, nothing that would make this evidence depend on Ride Recording. Every field is
 * nullable because a firmware may simply not report it.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureCoordinator.swift `VescFaultCaptureSample`
 * @parity /modules/vescape-core/src/index.ts `VescFaultCaptureSample`
 */
data class VescFaultCaptureSample(
  val capturedAtMs: Long,
  val speed: Double?,
  val dutyCycle: Double?,
  val erpm: Double?,
  val batteryVoltage: Double?,
  val batteryCurrent: Double?,
  val motorCurrent: Double?,
  val tempMosfet: Double?,
  val tempMotor: Double?,
  val pitch: Double?,
  val roll: Double?,
  val balancePitch: Double?,
  val adc1: Double?,
  val adc2: Double?,
  val state: Int?,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "capturedAtMs" to capturedAtMs,
    "speed" to speed,
    "dutyCycle" to dutyCycle,
    "erpm" to erpm,
    "batteryVoltage" to batteryVoltage,
    "batteryCurrent" to batteryCurrent,
    "motorCurrent" to motorCurrent,
    "tempMosfet" to tempMosfet,
    "tempMotor" to tempMotor,
    "pitch" to pitch,
    "roll" to roll,
    "balancePitch" to balancePitch,
    "adc1" to adc1,
    "adc2" to adc2,
    "state" to state,
  )

  companion object {
    /**
     * Project one decoded live-window map into a capture sample. Returns null when the map carries
     * no `lastPacketAt` — an untimestamped row cannot be placed inside a capture window.
     */
    fun fromLiveSample(map: Map<String, Any?>): VescFaultCaptureSample? {
      val capturedAt = (map["lastPacketAt"] as? Number)?.toLong() ?: return null
      fun num(key: String) = (map[key] as? Number)?.toDouble()
      return VescFaultCaptureSample(
        capturedAtMs = capturedAt,
        speed = num("speed"),
        dutyCycle = num("dutyCycle"),
        erpm = num("erpm"),
        batteryVoltage = num("batteryVoltage"),
        batteryCurrent = num("batteryCurrent"),
        motorCurrent = num("motorCurrent"),
        tempMosfet = num("tempMosfet"),
        tempMotor = num("tempMotor"),
        pitch = num("pitch"),
        roll = num("roll"),
        balancePitch = num("balancePitch"),
        adc1 = num("adc1"),
        adc2 = num("adc2"),
        state = (map["state"] as? Number)?.toInt(),
      )
    }
  }
}

/**
 * Metadata for one VESC Fault Capture. The occurrence id is the foreign key: one occurrence owns at
 * most one capture, and the capture outlives the Board Session that produced it.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureCoordinator.swift `VescFaultCapture`
 * @parity /modules/vescape-core/src/index.ts `VescFaultCapture`
 */
data class VescFaultCapture(
  val occurrenceId: String,
  val boardId: String,
  /** Intended start of the window: detection minus [VescFaultCaptureCoordinator.PRE_ROLL_MS]. */
  val startedAtMs: Long,
  /** When the fault was detected — the boundary between pre-roll and incident. */
  val openedAtMs: Long,
  /** Timestamp of the last retained sample, or null while the capture is still appending. */
  val endedAtMs: Long?,
  val sampleCount: Int,
  /** True only when the full two-second post-clear tail was observed. */
  val complete: Boolean,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "occurrenceId" to occurrenceId,
    "boardId" to boardId,
    "startedAtMs" to startedAtMs,
    "openedAtMs" to openedAtMs,
    "endedAtMs" to endedAtMs,
    "sampleCount" to sampleCount,
    "complete" to complete,
  )
}

/**
 * Narrow durable persistence for VESC Fault Captures. Production delegates to the Room DAO; tests
 * supply an in-memory fake so window boundaries are exercised without a database or BLE.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureCoordinator.swift `VescFaultCaptureStoring`
 */
interface VescFaultCaptureStore {
  suspend fun upsertCapture(capture: VescFaultCapture)
  suspend fun appendSamples(occurrenceId: String, samples: List<VescFaultCaptureSample>)
  suspend fun getCapture(occurrenceId: String): VescFaultCapture?
  suspend fun getSamples(occurrenceId: String): List<VescFaultCaptureSample>
}

/**
 * Deterministic owner of VESC Fault Capture windows.
 *
 * One occurrence owns every decoded Board sample from [PRE_ROLL_MS] before detection through
 * [TAIL_MS] after the controller reported a clear. The pre-roll is copied out of the native recent
 * decoded window that already backs `board.recentTelemetry` — deliberately **not** a second
 * always-on buffer — and persisted immediately, so a process kill loses only the tail.
 *
 * Windows are bounded by timestamps, never by sample counts: the Board Session is response-paced,
 * so a capture describes the rate actually achieved rather than a fabricated 30 Hz cadence.
 *
 * Captures are self-contained. A direct A-to-B code change closes A's window (which keeps appending
 * through its tail) and opens B's with its own five-second pre-roll, so the two intentionally
 * duplicate samples and each stays independently inspectable.
 *
 * Session or process end finalizes what exists and marks the capture incomplete. It never fabricates
 * a clear time — that belongs to [VescFaultCoordinator], and the controller never said it.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureCoordinator.swift
 */
class VescFaultCaptureCoordinator(
  private val store: VescFaultCaptureStore,
) {
  /**
   * Snapshot of the native recent decoded window, wired by the Board Session to
   * `TelemetryPipeline.recentSnapshot`. Null outside a session — a capture then opens empty and
   * fills from live samples only.
   */
  @Volatile
  var recentWindow: (() -> List<Map<String, Any?>>)? = null

  /**
   * `VESC Fault Collection` App Setting, mirrored from [VescFaultCoordinator] by the session
   * controller. Turning it off is an emergency kill switch: in-flight windows are dropped and no
   * further capture rows are written. Already-durable captures stay readable.
   */
  @Volatile
  private var collectionEnabled = true

  private class Window(
    val occurrenceId: String,
    val boardId: String,
    val startedAtMs: Long,
    val openedAtMs: Long,
  ) {
    /** Set when the occurrence cleared: the last sample timestamp still admitted into the window. */
    var tailDeadlineMs: Long? = null
    /** A sample arrived past [tailDeadlineMs], proving the whole post-clear tail was observed. */
    var tailCrossed = false
    var sampleCount = 0
    var lastSampleAtMs: Long? = null
    var finished = false
    val pending = ArrayList<VescFaultCaptureSample>()
  }

  private val lock = Any()
  private val windows = LinkedHashMap<String, Window>()

  /**
   * A new occurrence opened. Copies the pre-roll out of the recent decoded window and persists it
   * before returning, so the five seconds leading into the incident survive a process kill.
   */
  suspend fun openCapture(occurrenceId: String, boardId: String, openedAtMs: Long) {
    if (!collectionEnabled) return
    val startedAtMs = openedAtMs - PRE_ROLL_MS
    // No upper bound: the window is opened from the occurrence transition, which can trail detection
    // by a scheduling hop. Everything the live window holds by now belongs to this capture, and
    // [observeSample] refuses to re-add anything at or before [Window.lastSampleAtMs].
    val prefix = (recentWindow?.invoke() ?: emptyList())
      .mapNotNull { VescFaultCaptureSample.fromLiveSample(it) }
      .filter { it.capturedAtMs >= startedAtMs }
    val window = Window(occurrenceId, boardId, startedAtMs, openedAtMs).apply {
      sampleCount = prefix.size
      lastSampleAtMs = prefix.lastOrNull()?.capturedAtMs
    }
    synchronized(lock) { windows[occurrenceId] = window }
    store.upsertCapture(window.snapshot(ended = false))
    if (prefix.isNotEmpty()) store.appendSamples(occurrenceId, prefix)
  }

  /**
   * The occurrence cleared (or was displaced by another code). The window keeps appending until a
   * sample arrives more than [TAIL_MS] after the clear.
   */
  fun closeCapture(occurrenceId: String, clearedAtMs: Long) {
    synchronized(lock) { windows[occurrenceId]?.tailDeadlineMs = clearedAtMs + TAIL_MS }
  }

  /**
   * Offer one decoded live sample to every open window of this Board. Runs on the BLE hot path, so
   * it only touches memory: returns true when [flush] should be scheduled on a writer thread.
   */
  fun observeSample(boardId: String, map: Map<String, Any?>): Boolean {
    if (!collectionEnabled) return false
    if (synchronized(lock) { windows.isEmpty() }) return false
    val sample = VescFaultCaptureSample.fromLiveSample(map) ?: return false
    synchronized(lock) {
      var needsFlush = false
      for (window in windows.values) {
        if (window.boardId != boardId || window.finished) continue
        val deadline = window.tailDeadlineMs
        if (deadline != null && sample.capturedAtMs > deadline) {
          window.finished = true
          window.tailCrossed = true
          needsFlush = true
          continue
        }
        // The pre-roll already covers everything up to its snapshot, so never duplicate across the
        // open/append seam.
        val last = window.lastSampleAtMs
        if (last != null && sample.capturedAtMs <= last) continue
        window.pending.add(sample)
        window.sampleCount += 1
        window.lastSampleAtMs = sample.capturedAtMs
        if (window.pending.size >= FLUSH_THRESHOLD) needsFlush = true
      }
      return needsFlush
    }
  }

  /** Persist buffered samples and retire windows whose tail elapsed. */
  suspend fun flush() {
    val drained = synchronized(lock) {
      val work = windows.values.map { window ->
        val samples = window.pending.toList()
        window.pending.clear()
        Triple(window.snapshot(ended = window.finished), samples, window.finished)
      }
      windows.values.removeAll { it.finished }
      work
    }
    for ((capture, samples, retired) in drained) {
      if (samples.isNotEmpty()) store.appendSamples(capture.occurrenceId, samples)
      if (samples.isNotEmpty() || retired) store.upsertCapture(capture)
    }
  }

  /**
   * The Board Session ended. Persists what each window holds and marks it complete only if the full
   * post-clear tail had already been observed. No clear time is invented.
   */
  suspend fun onSessionEnded(boardId: String) = persistDetached(detachSession(boardId))

  /**
   * Take this Board's windows out of memory synchronously. The caller must hand the result to
   * [persistDetached]. Split from the write so a session that ends and immediately reconnects the
   * same Board cannot leak the next session's samples into the previous session's capture.
   */
  fun detachSession(boardId: String): List<Pair<VescFaultCapture, List<VescFaultCaptureSample>>> =
    synchronized(lock) {
      val work = windows.values.filter { it.boardId == boardId }.map { window ->
        val samples = window.pending.toList()
        window.pending.clear()
        window.snapshot(ended = true) to samples
      }
      windows.values.removeAll { it.boardId == boardId }
      work
    }

  /** Durable half of [detachSession]; safe to run on a writer thread. */
  suspend fun persistDetached(detached: List<Pair<VescFaultCapture, List<VescFaultCaptureSample>>>) {
    for ((capture, samples) in detached) {
      if (samples.isNotEmpty()) store.appendSamples(capture.occurrenceId, samples)
      store.upsertCapture(capture)
    }
  }

  /**
   * Mirror the `VESC Fault Collection` App Setting. Turning collection off drops every in-flight
   * window without writing: the kill switch must stop new persistence, and stored evidence is never
   * deleted by it.
   */
  fun setCollectionEnabled(enabled: Boolean) {
    collectionEnabled = enabled
    if (!enabled) synchronized(lock) { windows.clear() }
  }

  suspend fun capture(occurrenceId: String): VescFaultCapture? = store.getCapture(occurrenceId)

  suspend fun samples(occurrenceId: String): List<VescFaultCaptureSample> = store.getSamples(occurrenceId)

  /** Caller must hold [lock]. */
  private fun Window.snapshot(ended: Boolean): VescFaultCapture {
    return VescFaultCapture(
      occurrenceId = occurrenceId,
      boardId = boardId,
      startedAtMs = startedAtMs,
      openedAtMs = openedAtMs,
      endedAtMs = if (ended) lastSampleAtMs ?: openedAtMs else null,
      sampleCount = sampleCount,
      complete = ended && tailCrossed,
    )
  }

  companion object {
    /** Decoded samples retained before detection. */
    internal const val PRE_ROLL_MS = 5_000L

    /** Decoded samples retained after the controller reported a clear. */
    internal const val TAIL_MS = 2_000L

    /** Buffered samples before a window asks for a writer-thread flush. */
    internal const val FLUSH_THRESHOLD = 32

    @Volatile
    private var instance: VescFaultCaptureCoordinator? = null

    fun get(context: Context): VescFaultCaptureCoordinator {
      return instance ?: synchronized(this) {
        instance ?: run {
          val dao = TelemetryDatabase.get(context.applicationContext).telemetryDao()
          VescFaultCaptureCoordinator(RoomVescFaultCaptureStore(dao)).also { instance = it }
        }
      }
    }
  }
}

/** Production [VescFaultCaptureStore] backed by the shared Room DAO. */
private class RoomVescFaultCaptureStore(
  private val dao: expo.modules.vescapecore.telemetry.TelemetryDao,
) : VescFaultCaptureStore {
  override suspend fun upsertCapture(capture: VescFaultCapture) = dao.upsertVescFaultCapture(
    VescFaultCaptureEntity(
      occurrenceId = capture.occurrenceId,
      boardId = capture.boardId,
      startedAtMs = capture.startedAtMs,
      openedAtMs = capture.openedAtMs,
      endedAtMs = capture.endedAtMs,
      sampleCount = capture.sampleCount,
      complete = capture.complete,
    ),
  )

  override suspend fun appendSamples(occurrenceId: String, samples: List<VescFaultCaptureSample>) =
    dao.insertVescFaultCaptureSamples(
      samples.map {
        VescFaultCaptureSampleEntity(
          occurrenceId = occurrenceId,
          capturedAtMs = it.capturedAtMs,
          speed = it.speed,
          dutyCycle = it.dutyCycle,
          erpm = it.erpm,
          batteryVoltage = it.batteryVoltage,
          batteryCurrent = it.batteryCurrent,
          motorCurrent = it.motorCurrent,
          tempMosfet = it.tempMosfet,
          tempMotor = it.tempMotor,
          pitch = it.pitch,
          roll = it.roll,
          balancePitch = it.balancePitch,
          adc1 = it.adc1,
          adc2 = it.adc2,
          state = it.state,
        )
      },
    )

  override suspend fun getCapture(occurrenceId: String): VescFaultCapture? =
    dao.getVescFaultCapture(occurrenceId)?.let {
      VescFaultCapture(
        occurrenceId = it.occurrenceId,
        boardId = it.boardId,
        startedAtMs = it.startedAtMs,
        openedAtMs = it.openedAtMs,
        endedAtMs = it.endedAtMs,
        sampleCount = it.sampleCount,
        complete = it.complete,
      )
    }

  override suspend fun getSamples(occurrenceId: String): List<VescFaultCaptureSample> =
    dao.getVescFaultCaptureSamples(occurrenceId).map {
      VescFaultCaptureSample(
        capturedAtMs = it.capturedAtMs,
        speed = it.speed,
        dutyCycle = it.dutyCycle,
        erpm = it.erpm,
        batteryVoltage = it.batteryVoltage,
        batteryCurrent = it.batteryCurrent,
        motorCurrent = it.motorCurrent,
        tempMosfet = it.tempMosfet,
        tempMotor = it.tempMotor,
        pitch = it.pitch,
        roll = it.roll,
        balancePitch = it.balancePitch,
        adc1 = it.adc1,
        adc2 = it.adc2,
        state = it.state,
      )
    }
}
