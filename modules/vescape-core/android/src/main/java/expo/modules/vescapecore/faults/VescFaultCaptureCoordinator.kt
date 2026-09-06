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
  val sampleCount: Int,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "occurrenceId" to occurrenceId,
    "boardId" to boardId,
    "startedAtMs" to startedAtMs,
    "openedAtMs" to openedAtMs,
    "sampleCount" to sampleCount,
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
 * Copies the native recent-telemetry window once when a live fault opens. No future samples, open
 * windows, flush lifecycle, or session-end reconciliation.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureCoordinator.swift
 */
class VescFaultCaptureCoordinator(
  private val store: VescFaultCaptureStore,
) {
  /**
   * Snapshot of the native recent decoded window, wired by the Board Session to
   * `TelemetryPipeline.recentSnapshot`. Null outside a session — a capture then opens empty and
   * produces an empty capture.
   */
  @Volatile
  var recentWindow: (() -> List<Map<String, Any?>>)? = null

  /**
   * `VESC Fault Collection` App Setting, mirrored from [VescFaultCoordinator] by the session
   * controller. Turning it off stops new capture rows. Existing captures stay readable.
   */
  @Volatile
  private var collectionEnabled = true

  /** Copy and persist recent decoded telemetry at fault detection. */
  suspend fun capturePast(occurrenceId: String, boardId: String, openedAtMs: Long) {
    if (!collectionEnabled) return
    val startedAtMs = openedAtMs - PRE_ROLL_MS
    val samples = (recentWindow?.invoke() ?: emptyList())
      .mapNotNull { VescFaultCaptureSample.fromLiveSample(it) }
      .filter { it.capturedAtMs in startedAtMs..openedAtMs }
    store.upsertCapture(
      VescFaultCapture(
        occurrenceId = occurrenceId,
        boardId = boardId,
        startedAtMs = startedAtMs,
        openedAtMs = openedAtMs,
        sampleCount = samples.size,
      ),
    )
    if (samples.isNotEmpty()) store.appendSamples(occurrenceId, samples)
  }

  /**
   * Mirror the `VESC Fault Collection` App Setting. Existing evidence is never deleted by it.
   */
  fun setCollectionEnabled(enabled: Boolean) {
    collectionEnabled = enabled
  }

  suspend fun capture(occurrenceId: String): VescFaultCapture? = store.getCapture(occurrenceId)

  suspend fun samples(occurrenceId: String): List<VescFaultCaptureSample> = store.getSamples(occurrenceId)

  companion object {
    /** Decoded samples retained before detection. */
    internal const val PRE_ROLL_MS = 5_000L

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
      sampleCount = capture.sampleCount,
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
        sampleCount = it.sampleCount,
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
