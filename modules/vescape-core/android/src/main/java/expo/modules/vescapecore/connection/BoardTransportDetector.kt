package expo.modules.vescapecore.connection

import expo.modules.vescapecore.protocol.COMM_BMS_GET_VALUES
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN
import expo.modules.vescapecore.protocol.COMM_FW_VERSION
import expo.modules.vescapecore.protocol.COMM_PING_CAN
import expo.modules.vescapecore.protocol.REFLOAT_GET_ALLDATA
import expo.modules.vescapecore.protocol.REFLOAT_MAGIC
import expo.modules.vescapecore.config.RefloatConfigProtocol
import expo.modules.vescapecore.config.RefloatConfigProtocolResult
import expo.modules.vescapecore.protocol.VescGattClient
import expo.modules.vescapecore.protocol.VescGattListener
import expo.modules.vescapecore.protocol.VescPacketReassembler
import expo.modules.vescapecore.protocol.parseBmsValues
import expo.modules.vescapecore.protocol.parseFwVersion
import expo.modules.vescapecore.protocol.parseRefloatGetAllData

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.os.Handler
import android.util.Log

private const val DETECT_TAG = "VescDetect"
private const val DETECT_CONNECT_TIMEOUT_MS = 8_000L
private const val DETECT_FW_DELAY_MS = 300L
private const val DETECT_PING_DELAY_MS = 600L
private const val DETECT_GATT_RELEASE_DELAY_MS = 600L

private const val DETECT_PROBE_BMS_DELAY_MS = 300L
private const val DETECT_PROBE_FW_DELAY_MS = 600L
private const val DETECT_PROBE_INFO_DELAY_MS = 900L
private const val DETECT_CONNECT_SETTLE_MS = 500L
private const val DETECT_CONNECT_RETRY_BACKOFF_MS = 400L
private const val DETECT_CONNECT_MAX_ATTEMPTS = 3

/**
 * @parity /modules/vescape-core/ios/connection/BoardTransportDetector.swift
 */
@SuppressLint("MissingPermission")
internal class BoardTransportDetector(
  context: Context,
  private val handler: Handler,
  private val probeId: String,
  private val device: BluetoothDevice,
  private val recordDiagnostic: (String, Map<String, Any?>) -> Unit,
  private val onProgress: (Map<String, Any?>) -> Unit,
  private val onComplete: (TransportDetection.Result) -> Unit,
  private val onError: (String, String) -> Unit,
  private val nowMs: () -> Long = { System.currentTimeMillis() },
) : VescGattListener {

  private enum class Phase { Connecting, Pinging, Probing }

  private val reassembler = VescPacketReassembler()
  private val gatt = VescGattClient(context, handler, { null }, this)

  private val responders = linkedSetOf<Int>()
  private val probeQueue = ArrayDeque<BoardTransport>()
  private val observations = mutableListOf<TransportDetection.Probe>()
  private var current: BoardTransport? = null
  private var currentConfirmed = false
  private var currentHasBms = false
  private var currentVescFirmwareVersion: String? = null
  private var currentRefloatVersion: String? = null
  private var currentRefloatBaseVersion: String? = null
  private var connectAttempts = 0
  private var phase = Phase.Connecting
  private var stepTimeout: Runnable? = null
  private var finished = false
  private var startMs = 0L

  private fun elapsed(): Long = nowMs() - startMs

  /**
   * @parity /modules/vescape-core/ios/connection/BoardTransportDetector.swift `emitProgress`
   * @parity /modules/vescape-core/src/index.ts `BoardProbeStep`
   */
  private fun emitProgress(step: String, transport: BoardTransport? = null, withCanIds: Boolean = false) {
    val payload = mutableMapOf<String, Any?>("probeId" to probeId, "step" to step, "elapsedMs" to elapsed())
    if (transport != null) payload["transport"] = BoardTransport.toBridge(transport)
    if (withCanIds) payload["canIds"] = responders.toList()
    Log.d(DETECT_TAG, "progress step=$step transport=$transport canIds=$responders elapsed=${elapsed()}ms")
    recordProbeDiagnostic(
      "board_probe_progress",
      mapOf(
        "message" to "Board Probe progress: $step",
        "step" to step,
        "transport" to BoardTransport.toBridge(transport),
        "can_ids" to responders.toList().takeIf { withCanIds },
      ),
    )
    onProgress(payload)
  }

  private fun recordProbeDiagnostic(eventName: String, properties: Map<String, Any?> = emptyMap()) {
    recordDiagnostic(
      eventName,
      mapOf(
        "operation" to "board_probe",
        "probe_id" to probeId,
        "phase" to phase.name.lowercase(),
        "ble_id" to device.address,
        "elapsed_ms" to elapsed(),
      ) + properties,
    )
  }

  fun start() {
    startMs = nowMs()
    recordDiagnostic(
      "board_probe_started",
      mapOf("message" to "Board Probe started", "probe_id" to probeId, "ble_id" to device.address),
    )
    phase = Phase.Connecting
    attemptConnect(initial = true)
  }

  private fun attemptConnect(initial: Boolean) {
    if (finished) return
    connectAttempts++
    emitProgress("connecting")
    val delay = if (initial) DETECT_CONNECT_SETTLE_MS else DETECT_CONNECT_RETRY_BACKOFF_MS
    handler.postDelayed({
      if (finished) return@postDelayed
      gatt.clear(markIntentional = true)
      gatt.connect(device.address)
      armStep(DETECT_CONNECT_TIMEOUT_MS) {
        fail("PROBE_CONNECT_TIMEOUT", "Probe could not connect to the board")
      }
    }, delay)
  }

  override fun onGattConnected() {
    handler.post {
      if (finished) return@post
      recordDiagnostic(
        "board_probe_ble_connected",
        mapOf("message" to "BLE connected", "probe_id" to probeId, "ble_id" to device.address, "elapsed_ms" to elapsed()),
      )
    }
  }

  override fun onGattSubscribing() {
    handler.post {
      if (finished || phase != Phase.Connecting) return@post
      emitProgress("handshake")
    }
  }

  override fun onGattReady() {
    handler.post {
      if (finished || phase != Phase.Connecting) return@post
      cancelStep()
      recordDiagnostic(
        "board_probe_service_ready",
        mapOf("message" to "VESC service ready", "probe_id" to probeId, "elapsed_ms" to elapsed()),
      )
      emitProgress("pinging")
      phase = Phase.Pinging
      handler.postDelayed({ if (!finished) gatt.sendPayload(byteArrayOf(COMM_FW_VERSION.toByte())) }, DETECT_FW_DELAY_MS)
      handler.postDelayed({ if (!finished) gatt.sendPayload(byteArrayOf(COMM_PING_CAN.toByte())) }, DETECT_PING_DELAY_MS)
      armStep(DETECT_CAN_PING_TIMEOUT_MS) { beginProbing() }
    }
  }

  override fun onGattDisconnected(status: Int, intentional: Boolean) {
    handler.post {
      if (finished || intentional) return@post
      if (phase == Phase.Connecting) {
        if (connectAttempts < DETECT_CONNECT_MAX_ATTEMPTS) {
          cancelStep()
          recordDiagnostic(
            "board_probe_connect_retry",
            mapOf(
              "message" to "Connect attempt failed, retrying",
              "probe_id" to probeId,
              "status" to status,
              "attempt" to connectAttempts,
              "elapsed_ms" to elapsed(),
            ),
          )
          attemptConnect(initial = false)
          return@post
        }
        fail("PROBE_DISCONNECTED", "Board disconnected during probe (status=$status)")
      } else {
        Log.w(DETECT_TAG, "disconnected mid-detection status=$status phase=$phase")
        recordProbeDiagnostic(
          "board_probe_disconnected_mid_detection",
          mapOf(
            "message" to "Board Probe disconnected mid-detection",
            "status" to status,
            "current_transport" to BoardTransport.toBridge(current),
            "current_confirmed" to currentConfirmed,
            "current_has_bms" to currentHasBms,
            "confirmed_count" to observations.count { it.confirmed },
          ),
        )
        finalizeCurrentObservation()
        finishResolved()
      }
    }
  }

  override fun onGattFailure(code: String, message: String) {
    handler.post { if (!finished) fail(code, message) }
  }

  override fun onGattFrameChunk(chunk: ByteArray) {
    handler.post {
      if (finished) return@post
      for (payload in reassembler.feed(chunk)) handlePayload(payload)
    }
  }

  private fun handlePayload(payload: ByteArray) {
    if (payload.isEmpty()) return
    when (payload[0].toInt() and 0xff) {
      COMM_PING_CAN -> if (phase == Phase.Pinging) {
        var changed = false
        for (i in 1 until payload.size) {
          changed = responders.add(payload[i].toInt() and 0xff) || changed
        }
        if (changed) {
          recordProbeDiagnostic(
            "board_probe_can_responders_updated",
            mapOf(
              "message" to "Board Probe CAN responders updated",
              "can_ids" to responders.toList(),
              "can_id_count" to responders.size,
            ),
          )
        }
      }
      COMM_CUSTOM_APP_DATA -> if (phase == Phase.Probing && current != null) {
        val sample = parseRefloatGetAllData(payload, avgLatency = null, packetAt = nowMs(), location = null)
        if (sample != null) markConfirmed()
        markRefloatInfo(payload)
      }
      COMM_FW_VERSION -> if (phase == Phase.Probing && current != null) markFwVersion(payload)
      COMM_BMS_GET_VALUES -> if (phase == Phase.Probing && current != null) {
        if (parseBmsValues(payload, nowMs()) != null) markBms()
      }
      COMM_FORWARD_CAN -> if (phase == Phase.Probing && current != null && payload.size >= 3) {
        if (!forwardedForCurrent(payload)) return
        if ((payload[2].toInt() and 0xff) == COMM_FW_VERSION) {
          markFwVersion(payload.copyOfRange(2, payload.size))
        }
        markRefloatInfo(payload)
        if ((payload[2].toInt() and 0xff) == COMM_BMS_GET_VALUES &&
          parseBmsValues(payload.copyOfRange(2, payload.size), nowMs()) != null
        ) {
          markBms()
        }
      }
    }
  }

  private fun beginProbing() {
    if (finished) return
    phase = Phase.Probing
    probeQueue.clear()
    probeQueue.addAll(TransportDetection.candidatesToProbe(responders.toList()))
    probeNext()
  }

  private fun probeNext() {
    cancelStep()
    currentConfirmed = false
    currentHasBms = false
    currentVescFirmwareVersion = null
    currentRefloatVersion = null
    currentRefloatBaseVersion = null
    current = probeQueue.removeFirstOrNull()
    val transport = current ?: return finishResolved()
    emitProgress("probing", transport, withCanIds = true)
    recordDiagnostic(
      "board_probe_transport_probe_started",
      mapOf(
        "message" to "Probing transport",
        "probe_id" to probeId,
        "transport" to BoardTransport.toBridge(transport),
        "elapsed_ms" to elapsed(),
      ),
    )
    sendProbeBurst(transport)
    handler.postDelayed({ sendProbeBurst(transport) }, DETECT_PROBE_TIMEOUT_MS / 2)
    armStep(DETECT_PROBE_TIMEOUT_MS) { finalizeProbe() }
  }

  private fun sendProbeBurst(transport: BoardTransport) {
    if (finished || current !== transport) return
    gatt.sendPayload(probePayload(transport))
    handler.postDelayed({
      if (!finished && current === transport) gatt.sendPayload(bmsProbePayload(transport))
    }, DETECT_PROBE_BMS_DELAY_MS)
    handler.postDelayed({
      if (!finished && current === transport) gatt.sendPayload(fwVersionPayload(transport))
    }, DETECT_PROBE_FW_DELAY_MS)
    handler.postDelayed({
      if (!finished && current === transport) gatt.sendPayload(RefloatConfigProtocol.buildGetInfo(transport))
    }, DETECT_PROBE_INFO_DELAY_MS)
  }

  private fun markConfirmed() {
    if (currentConfirmed) return
    currentConfirmed = true
    recordProbeDiagnostic(
      "board_probe_telemetry_confirmed",
      mapOf(
        "message" to "Board Probe telemetry confirmed transport",
        "transport" to BoardTransport.toBridge(current),
        "can_ids" to responders.toList(),
      ),
    )
    emitProgress(if (currentHasBms) "identity" else "bms", current, withCanIds = true)
  }

  private fun markBms() {
    if (currentHasBms) return
    currentHasBms = true
    recordProbeDiagnostic(
      "board_probe_bms_detected",
      mapOf(
        "message" to "Board Probe detected smart-BMS",
        "transport" to BoardTransport.toBridge(current),
      ),
    )
    if (currentConfirmed) emitProgress("identity", current, withCanIds = true)
  }

  private fun markFwVersion(payload: ByteArray) {
    val firmware = parseFwVersion(payload) ?: return
    currentVescFirmwareVersion = firmware
    recordProbeDiagnostic(
      "board_probe_firmware_detected",
      mapOf(
        "message" to "Board Probe detected VESC firmware",
        "transport" to BoardTransport.toBridge(current),
        "vesc_firmware_version" to firmware,
      ),
    )
  }

  private fun markRefloatInfo(payload: ByteArray) {
    val version = when (val result = RefloatConfigProtocol.parseGetInfoResponse(payload)) {
      is RefloatConfigProtocolResult.Success -> result.value.version
      is RefloatConfigProtocolResult.Failure -> return
    }
    currentRefloatVersion = version
    currentRefloatBaseVersion = RefloatConfigProtocol.normalizeBaseVersion(version)
    recordProbeDiagnostic(
      "board_probe_refloat_detected",
      mapOf(
        "message" to "Board Probe detected Refloat identity",
        "transport" to BoardTransport.toBridge(current),
        "refloat_version" to currentRefloatVersion,
        "refloat_base_version" to currentRefloatBaseVersion,
      ),
    )
  }

  private fun finalizeProbe() {
    finalizeCurrentObservation()
    probeNext()
  }

  private fun finalizeCurrentObservation() {
    val transport = current ?: return
    cancelStep()
    observations.add(
      TransportDetection.Probe(
        transport = transport,
        confirmed = currentConfirmed,
        hasBms = currentHasBms,
        vescFirmwareVersion = currentVescFirmwareVersion,
        refloatVersion = currentRefloatVersion,
        refloatBaseVersion = currentRefloatBaseVersion,
      ),
    )
    recordProbeDiagnostic(
      "board_probe_transport_finished",
      mapOf(
        "message" to if (currentConfirmed) "Board Probe transport finished confirmed" else "Board Probe transport finished unconfirmed",
        "transport" to BoardTransport.toBridge(transport),
        "confirmed" to currentConfirmed,
        "has_bms" to currentHasBms,
        "vesc_firmware_version" to currentVescFirmwareVersion,
        "refloat_version" to currentRefloatVersion,
        "refloat_base_version" to currentRefloatBaseVersion,
      ),
    )
    if (currentConfirmed) {
      recordDiagnostic(
        "board_probe_transport_confirmed",
        mapOf(
          "message" to "Transport confirmed by telemetry sample",
          "probe_id" to probeId,
          "transport" to BoardTransport.toBridge(transport),
          "has_bms" to currentHasBms,
          "vesc_firmware_version" to currentVescFirmwareVersion,
          "refloat_version" to currentRefloatVersion,
          "refloat_base_version" to currentRefloatBaseVersion,
          "elapsed_ms" to elapsed(),
        ),
      )
    }
    current = null
  }

  private fun finishResolved() {
    if (finished) return
    val result = TransportDetection.resolve(observations)
    val outcome = when (result.outcome) {
      is TransportDetection.Outcome.Resolved -> "resolved"
      is TransportDetection.Outcome.NeedsPick -> "needs-pick"
      TransportDetection.Outcome.None -> "none"
    }
    recordDiagnostic(
      "board_probe_completed",
      mapOf(
        "message" to "Board Probe completed",
        "probe_id" to probeId,
        "candidate_count" to result.candidates.size,
        "outcome" to outcome,
        "elapsed_ms" to elapsed(),
      ),
    )
    emitProgress("completed")
    cleanup()
    completeAfterGattRelease { onComplete(result) }
  }

  private fun fail(code: String, message: String) {
    if (finished) return
    recordDiagnostic(
      "board_probe_failed",
      mapOf("message" to message, "probe_id" to probeId, "code" to code, "elapsed_ms" to elapsed()),
    )
    emitProgress("failed")
    cleanup()
    completeAfterGattRelease { onError(code, message) }
  }

  fun cancel(reason: String = "cancelled") {
    handler.post {
      if (finished) return@post
      recordProbeDiagnostic(
        "board_probe_cancelled",
        mapOf(
          "message" to "Board Probe cancelled",
          "reason" to reason,
        ),
      )
      cleanup()
    }
  }

  private fun cleanup() {
    finished = true
    cancelStep()
    gatt.clear()
  }

  private fun armStep(delayMs: Long, action: () -> Unit) {
    cancelStep()
    val runnable = Runnable {
      stepTimeout = null
      if (!finished) action()
    }
    stepTimeout = runnable
    handler.postDelayed(runnable, delayMs)
  }

  private fun cancelStep() {
    stepTimeout?.let { handler.removeCallbacks(it) }
    stepTimeout = null
  }

  private fun completeAfterGattRelease(action: () -> Unit) {
    handler.postDelayed(action, DETECT_GATT_RELEASE_DELAY_MS)
  }

  private fun probePayload(transport: BoardTransport): ByteArray = when (transport) {
    BoardTransport.Direct -> byteArrayOf(
      COMM_CUSTOM_APP_DATA.toByte(),
      REFLOAT_MAGIC.toByte(),
      REFLOAT_GET_ALLDATA.toByte(),
      2,
    )
    is BoardTransport.Can -> byteArrayOf(
      COMM_FORWARD_CAN.toByte(),
      transport.canId.toByte(),
      COMM_CUSTOM_APP_DATA.toByte(),
      REFLOAT_MAGIC.toByte(),
      REFLOAT_GET_ALLDATA.toByte(),
      2,
    )
  }

  private fun bmsProbePayload(transport: BoardTransport): ByteArray = when (transport) {
    BoardTransport.Direct -> byteArrayOf(COMM_BMS_GET_VALUES.toByte())
    is BoardTransport.Can -> byteArrayOf(
      COMM_FORWARD_CAN.toByte(),
      transport.canId.toByte(),
      COMM_BMS_GET_VALUES.toByte(),
    )
  }

  private fun fwVersionPayload(transport: BoardTransport): ByteArray = when (transport) {
    BoardTransport.Direct -> byteArrayOf(COMM_FW_VERSION.toByte())
    is BoardTransport.Can -> byteArrayOf(
      COMM_FORWARD_CAN.toByte(),
      transport.canId.toByte(),
      COMM_FW_VERSION.toByte(),
    )
  }

  private fun forwardedForCurrent(payload: ByteArray): Boolean {
    val transport = current
    return transport is BoardTransport.Can && payload.size >= 2 && (payload[1].toInt() and 0xff) == transport.canId
  }
}
