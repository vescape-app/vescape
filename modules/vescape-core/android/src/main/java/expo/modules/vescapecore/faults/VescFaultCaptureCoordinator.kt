package expo.modules.vescapecore.faults

import android.content.Context
import expo.modules.vescapecore.database.VescapeDatabase
import expo.modules.vescapecore.database.VescFaultCaptureEntity
import expo.modules.vescapecore.database.VescFaultCaptureSampleEntity

/**
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
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureCoordinator.swift `VescFaultCapture`
 * @parity /modules/vescape-core/src/index.ts `VescFaultCapture`
 */
data class VescFaultCapture(
  val occurrenceId: String,
  val boardId: String,
  val startedAtMs: Long,
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
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureCoordinator.swift `VescFaultCaptureStoring`
 */
interface VescFaultCaptureStore {
  suspend fun saveCapture(capture: VescFaultCapture, samples: List<VescFaultCaptureSample>)
  suspend fun getCapture(occurrenceId: String): VescFaultCapture?
  suspend fun getSamples(occurrenceId: String): List<VescFaultCaptureSample>
}

/**
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureCoordinator.swift
 */
class VescFaultCaptureCoordinator(
  private val store: VescFaultCaptureStore,
) {
  @Volatile
  var recentWindow: (() -> List<Map<String, Any?>>)? = null

  @Volatile
  private var collectionEnabled = true

  suspend fun capturePast(occurrenceId: String, boardId: String, openedAtMs: Long) {
    if (!collectionEnabled) return
    val startedAtMs = openedAtMs - PRE_ROLL_MS
    val samples = (recentWindow?.invoke() ?: emptyList())
      .mapNotNull { VescFaultCaptureSample.fromLiveSample(it) }
      .filter { it.capturedAtMs in startedAtMs..openedAtMs }
    store.saveCapture(
      VescFaultCapture(
        occurrenceId = occurrenceId,
        boardId = boardId,
        startedAtMs = startedAtMs,
        openedAtMs = openedAtMs,
        sampleCount = samples.size,
      ), samples,
    )
  }

  fun setCollectionEnabled(enabled: Boolean) {
    collectionEnabled = enabled
  }

  suspend fun capture(occurrenceId: String): VescFaultCapture? = store.getCapture(occurrenceId)

  suspend fun samples(occurrenceId: String): List<VescFaultCaptureSample> = store.getSamples(occurrenceId)

  companion object {
    internal const val PRE_ROLL_MS = 5_000L

    @Volatile
    private var instance: VescFaultCaptureCoordinator? = null

    fun get(context: Context): VescFaultCaptureCoordinator {
      return instance ?: synchronized(this) {
        instance ?: run {
          val dao = VescapeDatabase.get(context.applicationContext).vescapeDao()
          VescFaultCaptureCoordinator(RoomVescFaultCaptureStore(dao)).also { instance = it }
        }
      }
    }
  }
}

private class RoomVescFaultCaptureStore(
  private val dao: expo.modules.vescapecore.database.VescapeDao,
) : VescFaultCaptureStore {
  override suspend fun saveCapture(capture: VescFaultCapture, samples: List<VescFaultCaptureSample>) = dao.saveVescFaultCapture(
    VescFaultCaptureEntity(
      occurrenceId = capture.occurrenceId,
      boardId = capture.boardId,
      startedAtMs = capture.startedAtMs,
      openedAtMs = capture.openedAtMs,
      sampleCount = capture.sampleCount,
    ), samples.map {
        VescFaultCaptureSampleEntity(
          occurrenceId = capture.occurrenceId,
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
      })

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
