package expo.modules.vescapecore.connection

import expo.modules.vescapecore.replay.RecordedHardware
import expo.modules.vescapecore.runtime.LinkIdentity
import expo.modules.vescapecore.service.SessionConfig

import android.content.Context
import kotlinx.coroutines.CancellationException
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.telemetry.AppDataRepository

internal const val DEFAULT_BOARD_NAME = "VESC Board"

/**
 * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `resolve`
 */
internal suspend fun buildSessionConfig(
    context: Context,
    boardId: String,
    recordingEnabled: Boolean,
    hardware: RecordedHardware? = null,
): SessionConfig {
    val repo = AppDataRepository.get(context.applicationContext)
    val board = try {
        repo.getBoard(boardId)
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        RecordingStorageFailure.reportRead("board_connect_read", error)
        throw error
    }
        ?: throw IllegalArgumentException("Board not found: $boardId")
    if (board["deletedAt"] != null) {
        throw IllegalArgumentException("Board is deleted: $boardId")
    }
    @Suppress("UNCHECKED_CAST")
    val link = board["link"] as? Map<String, Any?>
    val bleId = (link?.get("bleId") as? String)?.takeIf { it.isNotBlank() }
    val boardName = board["name"] as? String ?: DEFAULT_BOARD_NAME
    val pollIntervalMs = hardware?.pollIntervalMs ?: pollIntervalMsForHz(try {
        repo.getTypedSettings().telemetryPollRateHz
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        RecordingStorageFailure.reportRead("board_connect_settings_read", error)
        throw error
    })
    if (hardware != null) {
        return SessionConfig(
            appBoardId = boardId,
            deviceId = bleId ?: hardware.deviceId ?: boardId,
            deviceName = boardName,
            transport = hardware.transport,
            linkVersion = LinkIdentity.CURRENT_LINK_VERSION,
            hasBms = hardware.hasBms,
            vescFirmwareVersion = hardware.firmware,
            refloatVersion = hardware.refloatVersion,
            refloatBaseVersion = hardware.refloatVersion?.let(LinkIdentity::normalizeRefloatBaseVersion),
            pollIntervalMs = pollIntervalMs,
            recordingEnabled = recordingEnabled,
            telemetryRecordingEnabled = false,
            autoReconnect = true,
        )
    }
    if (link == null || bleId == null) {
        throw IllegalArgumentException("Board has no Board Link: $boardId")
    }
    return SessionConfig(
        appBoardId = boardId,
        deviceId = bleId,
        deviceName = boardName,
        transport = BoardTransport.fromBridge(link["transport"]),
        linkVersion = (link["linkVersion"] as? Number)?.toInt(),
        hasBms = link["hasBms"] as? Boolean,
        vescFirmwareVersion = link["vescFirmwareVersion"] as? String,
        refloatVersion = link["refloatVersion"] as? String,
        refloatBaseVersion = link["refloatBaseVersion"] as? String,
        pollIntervalMs = pollIntervalMs,
        recordingEnabled = recordingEnabled,
        telemetryRecordingEnabled = false,
        autoReconnect = true,
    )
}
